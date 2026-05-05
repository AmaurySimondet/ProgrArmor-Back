/**
 * Audit + (optionnel) upsert des edges manquants Street Figures.
 *
 * Usage:
 *   node oneShotQueries/auditStreetFigureMissingEdges.js
 *   node oneShotQueries/auditStreetFigureMissingEdges.js --apply
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");
const VariationProgressionEdge = require("../schema/variationProgressionEdge");

const DETAILS_TYPE_ID = "669cda3b33e75a33610be158";
const EXERCISES_TYPE_ID = "669cee980c89e9434327caa8";

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

const ORDERED_DETAILS = Object.entries(DETAIL_INTENSITY_COEFFICIENTS)
    .sort((a, b) => a[1] - b[1])
    .map(([label]) => label);

function normalizeLabel(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function inferDetailKey(nameFr, nameEn) {
    const n = normalizeLabel(`${nameEn || ""} ${nameFr || ""}`);
    if (n.includes("advanced one leg")) return "advanced one leg";
    if (n.includes("closed hip straddle")) return "closed hip straddle";
    if (n.includes("one leg half")) return "one leg half";
    if (n.includes("advanced tuck")) return "advanced tuck";
    if (n.includes("open hip straddle")) return "open hip straddle";
    if (n.includes("half lay")) return "half lay";
    if (n.includes("full")) return "full";
    if (n.includes("one leg")) return "one leg";
    if (n.includes("tuck")) return "tuck";
    return null;
}

function ratioBetween(fromKey, toKey) {
    const from = DETAIL_INTENSITY_COEFFICIENTS[fromKey];
    const to = DETAIL_INTENSITY_COEFFICIENTS[toKey];
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
    return Math.round(((to / from) + Number.EPSILON) * 1000) / 1000;
}

function edgeKey(fromId, toId, contextId) {
    return `${String(fromId)}|${String(toId)}|${contextId ? String(contextId) : "null"}`;
}

async function run() {
    const shouldApply = process.argv.includes("--apply");
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) throw new Error("Missing MONGO_URL/mongoURL or DATABASE.");

    await mongoose.connect(mongoUrl + database);

    const detailVariations = await Variation.find(
        { type: new mongoose.Types.ObjectId(DETAILS_TYPE_ID) },
        { _id: 1, "name.fr": 1, "name.en": 1 }
    ).lean();
    const detailById = new Map(detailVariations.map((d) => [String(d._id), d]));

    const streetExerciseVariations = await Variation.find(
        {
            type: new mongoose.Types.ObjectId(EXERCISES_TYPE_ID),
            isExercice: true,
            equivalentTo: { $exists: true, $ne: [] }
        },
        { _id: 1, equivalentTo: 1, "name.fr": 1, "name.en": 1, verified: 1 }
    ).lean();

    const groupedByMain = new Map();
    for (const variation of streetExerciseVariations) {
        const eq = Array.isArray(variation.equivalentTo) ? variation.equivalentTo.map((id) => String(id)) : [];
        if (eq.length < 2) continue;
        const mainId = eq[0];
        const detailId = eq[1];
        const detailDoc = detailById.get(detailId);
        const detailKey = inferDetailKey(detailDoc?.name?.fr, detailDoc?.name?.en);
        if (!detailKey) continue;
        if (!groupedByMain.has(mainId)) groupedByMain.set(mainId, []);
        groupedByMain.get(mainId).push({
            variationId: String(variation._id),
            variationName: variation?.name?.fr || variation?.name?.en || String(variation._id),
            detailId,
            detailKey,
            detailOrder: ORDERED_DETAILS.indexOf(detailKey),
            verified: variation?.verified === true
        });
    }

    const existingEdges = await VariationProgressionEdge.find(
        { isActive: true },
        { fromVariationId: 1, toVariationId: 1, contextVariationId: 1, difficultyRatio: 1 }
    ).lean();
    const existingEdgeSet = new Set(
        existingEdges.map((e) => edgeKey(e.fromVariationId, e.toVariationId, e.contextVariationId))
    );

    const missingEdges = [];
    for (const [mainId, list] of groupedByMain.entries()) {
        const ordered = list
            .filter((x) => Number.isInteger(x.detailOrder) && x.detailOrder >= 0)
            .sort((a, b) => a.detailOrder - b.detailOrder);
        for (let i = 0; i < ordered.length - 1; i += 1) {
            const from = ordered[i];
            const to = ordered[i + 1];
            if (to.detailOrder <= from.detailOrder) continue;
            const ratio = ratioBetween(from.detailKey, to.detailKey);
            if (!Number.isFinite(ratio) || ratio <= 0) continue;

            const fwdKey = edgeKey(from.variationId, to.variationId, mainId);
            if (!existingEdgeSet.has(fwdKey)) {
                missingEdges.push({
                    fromVariationId: from.variationId,
                    fromVariationName: from.variationName,
                    toVariationId: to.variationId,
                    toVariationName: to.variationName,
                    contextVariationId: mainId,
                    isExerciseVariation: true,
                    difficultyRatio: ratio,
                    confidence: "medium",
                    source: "manual",
                    notes: `Street figures inferred progression ${from.detailKey} -> ${to.detailKey}`,
                    isActive: true
                });
            }

            const revRatio = Math.round(((1 / ratio) + Number.EPSILON) * 1000) / 1000;
            const revKey = edgeKey(to.variationId, from.variationId, mainId);
            if (!existingEdgeSet.has(revKey)) {
                missingEdges.push({
                    fromVariationId: to.variationId,
                    fromVariationName: to.variationName,
                    toVariationId: from.variationId,
                    toVariationName: from.variationName,
                    contextVariationId: mainId,
                    isExerciseVariation: true,
                    difficultyRatio: revRatio,
                    confidence: "medium",
                    source: "manual",
                    notes: `Street figures inferred progression reverse ${to.detailKey} -> ${from.detailKey}`,
                    isActive: true
                });
            }
        }
    }

    console.log("=== Street Figure Edge Audit ===");
    console.log({
        streetExerciseVariations: streetExerciseVariations.length,
        contextsDetected: groupedByMain.size,
        missingEdges: missingEdges.length,
        applyMode: shouldApply
    });
    console.log("=== Missing Edges Preview (first 40) ===");
    console.log(missingEdges.slice(0, 40));

    if (shouldApply && missingEdges.length > 0) {
        let upserted = 0;
        for (const edge of missingEdges) {
            await VariationProgressionEdge.updateOne(
                {
                    fromVariationId: edge.fromVariationId,
                    toVariationId: edge.toVariationId,
                    contextVariationId: edge.contextVariationId
                },
                { $set: edge },
                { upsert: true }
            );
            upserted += 1;
        }
        console.log("=== Apply Result ===");
        console.log({ upserted });
    }

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error("Audit failed:", err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exitCode = 1;
});

