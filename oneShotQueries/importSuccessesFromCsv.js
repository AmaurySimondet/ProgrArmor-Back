const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const Success = require("../schema/success");

const mongoURL = process.env.mongoURL;
const DATABASE = process.env.DATABASE;
const csvPath = path.join(__dirname, "successes.normalized.csv");
const SUCCESS_PICTURE_CDN_BASE = "https://d28n1fykqesg8f.cloudfront.net/successes";

function parseCsvLine(line) {
    const out = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            out.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    out.push(current);
    return out;
}

function parseNumeric(val) {
    if (val == null || val === "") return null;
    const v = String(val).trim().toLowerCase();
    const k = v.endsWith("k");
    const m = v.endsWith("m");
    const n = Number(v.replace(/[km]/g, ""));
    if (!Number.isFinite(n)) return null;
    if (k) return n * 1000;
    if (m) return n * 1000000;
    return n;
}

function nullable(value) {
    if (value == null) return null;
    const s = String(value).trim();
    return s.length ? s : null;
}

function cdnPictureUrl(slug) {
    const s = nullable(slug);
    if (!s) return null;
    return `${SUCCESS_PICTURE_CDN_BASE}/${s}.png`;
}

function buildPictures(row) {
    const fr = cdnPictureUrl(row.picture_fr ?? row.pictureFr);
    const en = cdnPictureUrl(row.picture_en ?? row.pictureEn);
    if (fr || en) return { fr, en };
    const legacy = cdnPictureUrl(row.picture);
    if (legacy) return { fr: legacy, en: legacy };
    return { fr: null, en: null };
}

function parseObjectIdOrNull(value) {
    const raw = nullable(value);
    if (!raw) return null;
    return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

function parseObjectIdArray(value) {
    const raw = nullable(value);
    if (!raw) return [];
    return raw
        .split("|")
        .map(v => v.trim())
        .filter(Boolean)
        .map(v => (mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : null))
        .filter(Boolean);
}

function buildCondition(row) {
    return {
        condition_code: row.condition_code,
        collection: nullable(row.collection),
        field: nullable(row.field),
        howMany: parseNumeric(row.howMany),
        userId: parseObjectIdOrNull(row.userId),
        inactivityPeriodDays: parseNumeric(row.inactivityPeriodDays),
        durationMinSecs: parseNumeric(row.durationMinSecs),
        durationMaxSecs: parseNumeric(row.durationMaxSecs),
        excludedMusclesInSeance: nullable(row.excludedMusclesInSeance),
        specificDayMonth: nullable(row.specificDayMonth),
        datetimeBetweenStart: nullable(row.datetimeBetweenStart),
        datetimeBetweenEnd: nullable(row.datetimeBetweenEnd),
        timeBetweenStart: nullable(row.timeBetweenStart),
        timeBetweenEnd: nullable(row.timeBetweenEnd),
        effectiveWeightLoadMin: parseNumeric(row.effectiveWeightLoadMin),
        valueMin: parseNumeric(row.valueMin),
        variationIds: parseObjectIdArray(row.variationIds),
        variationType: parseObjectIdOrNull(row.variationType),
        variationTypeMinExercises: parseNumeric(row.variationTypeMinExercises),
        conditionValue: nullable(row.conditionValue),
    };
}

async function run() {
    if (!mongoURL || !DATABASE) {
        throw new Error("mongoURL / DATABASE env variables are required");
    }
    const raw = fs.readFileSync(csvPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("CSV is empty");

    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    const required = [
        "type", "level", "name_fr", "name_en", "description_fr", "description_en",
        "hint_fr", "hint_en", "condition_code", "collection", "field", "howMany",
        "userId", "inactivityPeriodDays", "durationMinSecs", "durationMaxSecs",
        "excludedMusclesInSeance", "specificDayMonth", "datetimeBetweenStart", "datetimeBetweenEnd",
        "timeBetweenStart", "timeBetweenEnd", "effectiveWeightLoadMin", "valueMin",
        "variationIds", "variationType", "variationTypeMinExercises", "conditionValue"
    ];
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length) {
        throw new Error(`Missing required columns: ${missing.join(", ")}`);
    }
    const hasPics = headers.includes("picture_fr") && headers.includes("picture_en");
    const hasLegacyPicture = headers.includes("picture");
    if (!hasPics && !hasLegacyPicture) {
        throw new Error("CSV must include picture_fr and picture_en, or legacy picture column");
    }

    const indexByHeader = new Map(headers.map((h, i) => [h, i]));
    const rows = lines.slice(1).map(line => {
        const values = parseCsvLine(line);
        const obj = {};
        for (const h of headers) {
            obj[h] = values[indexByHeader.get(h)] ?? "";
        }
        return obj;
    });

    await mongoose.connect(mongoURL + DATABASE);
    try {
        const ops = rows.map(row => {
            const doc = {
                type: row.type,
                level: Number(row.level),
                name: { fr: row.name_fr, en: row.name_en },
                description: { fr: row.description_fr, en: row.description_en },
                hint: { fr: row.hint_fr || "", en: row.hint_en || "" },
                picture: buildPictures(row),
                condition: buildCondition(row),
                conditionUpdatedAt: new Date(),
            };
            return {
                updateOne: {
                    filter: {
                        type: doc.type,
                        level: doc.level,
                        "name.fr": doc.name.fr,
                    },
                    update: { $set: doc },
                    upsert: true,
                }
            };
        });
        if (ops.length) await Success.bulkWrite(ops, { ordered: false });
        console.log(`Imported/updated ${ops.length} successes from CSV`);
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error("[importSuccessesFromCsv] error", err);
    process.exit(1);
});
