const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const VariationProgressionEdge = require("../schema/variationProgressionEdge");

const CSV_PATH = path.join(__dirname, "data", "streetworkout-variations.csv");

const DETAIL_INTENSITY_COEFFICIENTS = {
    tuck: 1.0,
    "advanced tuck": 1.3,
    "one leg": 1.6,
    "one leg half": 1.8,
    "closed hip straddle": 2.0,
    "advanced one leg": 2.2,
    "open hip straddle": 2.4,
    "half lay": 2.6,
    full: 3.0
};

const DETAILS_ORDER = Object.entries(DETAIL_INTENSITY_COEFFICIENTS)
    .sort((a, b) => a[1] - b[1])
    .map(([label]) => label);

function normalizeLabel(value) {
    return String(value || "").trim().toLowerCase();
}

function parseCsvLine(line) {
    const out = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            out.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    out.push(current);
    return out;
}

function buildRowsFromCsv(content) {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]).map((h) => h.trim());
    const col = new Map(headers.map((h, i) => [h, i]));

    const getCell = (arr, name) => {
        const idx = col.get(name);
        return idx === undefined ? "" : (arr[idx] || "").trim();
    };

    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
        const cells = parseCsvLine(lines[i]);
        rows.push({
            _id: getCell(cells, "_id"),
            typeLabel: getCell(cells, "typeLabel"),
            isExercice: getCell(cells, "isExercice") === "TRUE",
            nameFr: getCell(cells, "name_fr"),
            nameEn: getCell(cells, "name_en"),
            equivalentTo: getCell(cells, "equivalentTo")
        });
    }

    return rows;
}

function extractEquivalentIds(equivalentToCell) {
    return String(equivalentToCell || "")
        .split("|")
        .map((id) => id.trim())
        .filter(Boolean);
}

function toObjectId(value) {
    return new mongoose.Types.ObjectId(value);
}

function createDetailEdges(detailRows) {
    const detailByLabel = new Map();
    for (const row of detailRows) {
        const key = normalizeLabel(row.nameEn || row.nameFr);
        detailByLabel.set(key, row);
    }

    const edges = [];
    for (let i = 0; i < DETAILS_ORDER.length - 1; i += 1) {
        const fromKey = DETAILS_ORDER[i];
        const toKey = DETAILS_ORDER[i + 1];
        const ratio = getDirectRatioByCoefficient(fromKey, toKey);
        const fromDetail = detailByLabel.get(fromKey);
        const toDetail = detailByLabel.get(toKey);

        if (!fromDetail || !toDetail || !Number.isFinite(ratio) || ratio <= 0) {
            continue;
        }

        edges.push({
            fromVariationId: toObjectId(fromDetail._id),
            fromVariationName: fromDetail.nameFr || fromDetail.nameEn || "",
            toVariationId: toObjectId(toDetail._id),
            toVariationName: toDetail.nameFr || toDetail.nameEn || "",
            isExerciseVariation: false,
            difficultyRatio: ratio,
            confidence: "medium",
            source: "manual",
            contextVariationId: null,
            notes: `Street workout detail progression (CI): ${fromKey} -> ${toKey}`,
            isActive: true
        });
    }

    return edges;
}

function withReverseEdges(edges, label) {
    const out = [];
    for (const edge of edges) {
        out.push(edge);
        const directRatio = Number(edge?.difficultyRatio);
        if (!Number.isFinite(directRatio) || directRatio <= 0) continue;
        const reverseRatio = Math.round(((1 / directRatio) + Number.EPSILON) * 1000) / 1000;
        if (!Number.isFinite(reverseRatio) || reverseRatio <= 0) continue;
        out.push({
            ...edge,
            fromVariationId: edge.toVariationId,
            fromVariationName: edge.toVariationName,
            toVariationId: edge.fromVariationId,
            toVariationName: edge.fromVariationName,
            difficultyRatio: reverseRatio,
            notes: `${label} reverse edge`
        });
    }
    return out;
}

function createExerciseEdges(exerciseRows, detailRows) {
    const orderedDetailsIndex = new Map(DETAILS_ORDER.map((label, idx) => [label, idx]));
    const detailOrderById = new Map();
    for (const row of detailRows) {
        const label = normalizeLabel(row.nameEn || row.nameFr);
        const idx = orderedDetailsIndex.get(label);
        if (Number.isInteger(idx)) {
            detailOrderById.set(row._id, idx);
        }
    }

    const byBaseExercise = new Map();
    for (const row of exerciseRows) {
        const eqIds = extractEquivalentIds(row.equivalentTo);
        if (eqIds.length < 2) continue;
        const [baseExerciseId, detailId] = eqIds;

        if (!byBaseExercise.has(baseExerciseId)) byBaseExercise.set(baseExerciseId, []);
        byBaseExercise.get(baseExerciseId).push({
            ...row,
            baseExerciseId,
            detailId,
            detailOrderIdx: detailOrderById.get(detailId)
        });
    }

    // fallback: explicit detail label from exercise name
    for (const [, list] of byBaseExercise) {
        for (const item of list) {
            if (Number.isInteger(item.detailOrderIdx)) continue;
            item.detailOrderIdx = inferDetailOrderFromName(item.nameEn || item.nameFr);
        }
        list.sort((a, b) => (a.detailOrderIdx ?? 999) - (b.detailOrderIdx ?? 999));
    }

    const edges = [];
    for (const [, list] of byBaseExercise) {
        for (let i = 0; i < list.length - 1; i += 1) {
            const from = list[i];
            const to = list[i + 1];
            if (!Number.isInteger(from.detailOrderIdx) || !Number.isInteger(to.detailOrderIdx)) continue;
            if (to.detailOrderIdx <= from.detailOrderIdx) continue;

            const ratio = getRatioFromDetailDistance(from.detailOrderIdx, to.detailOrderIdx);
            if (!Number.isFinite(ratio) || ratio <= 0) continue;

            edges.push({
                fromVariationId: toObjectId(from._id),
                fromVariationName: from.nameFr || from.nameEn || "",
                toVariationId: toObjectId(to._id),
                toVariationName: to.nameFr || to.nameEn || "",
                isExerciseVariation: true,
                difficultyRatio: ratio,
                confidence: "medium",
                source: "manual",
                contextVariationId: toObjectId(from.baseExerciseId),
                notes: `Street workout exercise progression inferred by detail order (${from.nameEn} -> ${to.nameEn})`,
                isActive: true
            });
        }
    }

    return edges;
}

function inferDetailOrderFromName(name) {
    const n = normalizeLabel(name);
    if (n.includes("advanced one leg")) return DETAILS_ORDER.indexOf("advanced one leg");
    if (n.includes("closed hip straddle")) return DETAILS_ORDER.indexOf("closed hip straddle");
    if (n.includes("one leg half")) return DETAILS_ORDER.indexOf("one leg half");
    if (n.includes("advanced tuck")) return 1;
    if (n.includes("open hip straddle")) return DETAILS_ORDER.indexOf("open hip straddle");
    if (n.includes("half lay")) return DETAILS_ORDER.indexOf("half lay");
    if (n.includes("full")) return DETAILS_ORDER.indexOf("full");
    if (n.includes("one leg")) return DETAILS_ORDER.indexOf("one leg");
    if (n.includes("straddle")) return DETAILS_ORDER.indexOf("open hip straddle");
    if (n.includes("tuck")) return 0;
    return null;
}

function getDirectRatioByCoefficient(fromKey, toKey) {
    const fromCoeff = DETAIL_INTENSITY_COEFFICIENTS[fromKey];
    const toCoeff = DETAIL_INTENSITY_COEFFICIENTS[toKey];
    if (!Number.isFinite(fromCoeff) || !Number.isFinite(toCoeff) || fromCoeff <= 0) return null;
    return Math.round(((toCoeff / fromCoeff) + Number.EPSILON) * 1000) / 1000;
}

function getRatioFromDetailDistance(fromIdx, toIdx) {
    const fromKey = DETAILS_ORDER[fromIdx];
    const toKey = DETAILS_ORDER[toIdx];
    return getDirectRatioByCoefficient(fromKey, toKey);
}

async function upsertEdges(edges) {
    let insertedOrUpdated = 0;
    const activeKeys = new Set();
    for (const edge of edges) {
        const key = [
            String(edge.fromVariationId),
            String(edge.toVariationId),
            edge.contextVariationId ? String(edge.contextVariationId) : "null"
        ].join("|");
        activeKeys.add(key);

        await VariationProgressionEdge.updateOne(
            {
                fromVariationId: edge.fromVariationId,
                toVariationId: edge.toVariationId,
                contextVariationId: edge.contextVariationId
            },
            { $set: edge },
            { upsert: true }
        );
        insertedOrUpdated += 1;
    }

    const existingStreetWorkoutEdges = await VariationProgressionEdge.find(
        {
            source: "manual",
            notes: /Street workout/i
        },
        { _id: 1, fromVariationId: 1, toVariationId: 1, contextVariationId: 1 }
    ).lean();

    const obsoleteIds = existingStreetWorkoutEdges
        .filter((doc) => {
            const key = [
                String(doc.fromVariationId),
                String(doc.toVariationId),
                doc.contextVariationId ? String(doc.contextVariationId) : "null"
            ].join("|");
            return !activeKeys.has(key);
        })
        .map((doc) => doc._id);

    let deletedCount = 0;
    if (obsoleteIds.length > 0) {
        const deleteResult = await VariationProgressionEdge.deleteMany({ _id: { $in: obsoleteIds } });
        deletedCount = deleteResult.deletedCount || 0;
    }

    return { insertedOrUpdated, deletedCount };
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;

    if (!mongoUrl || !database) {
        console.error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
        process.exit(1);
    }

    try {
        const rawCsv = fs.readFileSync(CSV_PATH, "utf8");
        const rows = buildRowsFromCsv(rawCsv);

        const detailRows = rows.filter((r) => r.typeLabel === "details" && mongoose.Types.ObjectId.isValid(r._id));
        const exerciseRows = rows.filter((r) => r.typeLabel === "exercices" && mongoose.Types.ObjectId.isValid(r._id));

        const detailEdges = withReverseEdges(
            createDetailEdges(detailRows),
            "Street workout detail progression"
        );
        const exerciseEdges = withReverseEdges(
            createExerciseEdges(exerciseRows, detailRows),
            "Street workout exercise progression"
        );
        const allEdges = [...detailEdges, ...exerciseEdges];

        await mongoose.connect(mongoUrl + database);
        console.log("Connected to MongoDB");

        const { insertedOrUpdated, deletedCount } = await upsertEdges(allEdges);
        console.log(`Edges upserted: ${insertedOrUpdated}`);
        console.log(`Obsolete edges deleted: ${deletedCount}`);
        console.log(`- detail edges: ${detailEdges.length}`);
        console.log(`- exercise edges: ${exerciseEdges.length}`);
    } catch (error) {
        console.error("Import failed:", error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
}

run();
