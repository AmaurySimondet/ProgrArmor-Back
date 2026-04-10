const { MongoClient } = require("mongodb");
require("dotenv").config();

const APPLY_MODE = process.argv.includes("--apply");

const uri = process.env.mongoURL;
const databaseName = process.env.DATABASE?.replace(/^\//, "");

if (!uri) {
    throw new Error("Missing env var: mongoURL");
}

if (!databaseName) {
    throw new Error("Missing env var: DATABASE");
}

const TYPE_PROFILES_BY_FR_NAME = {
    "Type de barre / poids": { global: 46, bodyweight_plus_external: 8, external_free: 65, external_machine: 40 },
    "Type de prise": { global: 68, bodyweight_plus_external: 86, external_free: 70, external_machine: 55 },
    "Unilatéral": { global: 65, bodyweight_plus_external: 75, external_free: 65, external_machine: 45 },
    "Type d'éxecution": { global: 62, bodyweight_plus_external: 60, external_free: 60, external_machine: 55 },
    "Type d'éxecution spécifique": { global: 62, bodyweight_plus_external: 80, external_free: 58, external_machine: 45 },
    "Tempo": { global: 60, bodyweight_plus_external: 65, external_free: 62, external_machine: 50 },
    "Forme / Partiel": { global: 58, bodyweight_plus_external: 65, external_free: 60, external_machine: 48 },
    "Positionnement des mains": { global: 50, bodyweight_plus_external: 62, external_free: 45, external_machine: 28 },
    "Positionnement des pieds": { global: 48, bodyweight_plus_external: 68, external_free: 48, external_machine: 30 },
    "Positionnement des bras": { global: 45, bodyweight_plus_external: 55, external_free: 45, external_machine: 38 },
    "Positionnement des jambes": { global: 45, bodyweight_plus_external: 58, external_free: 44, external_machine: 32 },
    "Positionnement du corps": { global: 52, bodyweight_plus_external: 60, external_free: 52, external_machine: 42 },
    "Point de départ": { global: 46, bodyweight_plus_external: 52, external_free: 48, external_machine: 36 },
    "Muscle": { global: 50, bodyweight_plus_external: 48, external_free: 50, external_machine: 52 },
    "Inclinaison": { global: 50, bodyweight_plus_external: 35, external_free: 60, external_machine: 50 },
    "Marque de machine": { global: 25, bodyweight_plus_external: 3, external_free: 8, external_machine: 60 },
    "Variante Street Workout": { global: 35, bodyweight_plus_external: 55, external_free: 15, external_machine: 5 },
    "Variante d'exercice d'haltérophilie": { global: 40, bodyweight_plus_external: 6, external_free: 70, external_machine: 12 },
    "Variante d'exercice explosif": { global: 42, bodyweight_plus_external: 65, external_free: 45, external_machine: 18 },
    "Positionnement élastique(s)/sangle(s)": { global: 30, bodyweight_plus_external: 45, external_free: 35, external_machine: 25 },
    "Ouverture coudes / genoux": { global: 35, bodyweight_plus_external: 45, external_free: 40, external_machine: 30 },
    "Accessoire supplémentaire ou objet spécifique": { global: 30, bodyweight_plus_external: 30, external_free: 38, external_machine: 25 },
    "Gêne / douleur / blessure": { global: 12, bodyweight_plus_external: 8, external_free: 8, external_machine: 8 }
};

const FALLBACK_PROFILE = { global: 35, bodyweight_plus_external: 35, external_free: 35, external_machine: 35 };

const KEYWORDS = {
    machine: [
        "machine",
        "poulie",
        "guid",
        "technogym",
        "life fitness",
        "precor",
        "hammer strength",
        "cybex",
        "matrix",
        "gym80",
        "tunturi",
        "rogue",
        "bh fitness"
    ],
    free: [
        "haltere",
        "haltère",
        "barre",
        "ez",
        "kettlebell",
        "snatch grip",
        "clean grip",
        "hook grip",
        "fat grip",
        "supination",
        "pronation",
        "marteau"
    ],
    bodyweight: [
        "anneaux",
        "au sol",
        "sur les poings",
        "sur les doigts",
        "mains",
        "pieds",
        "tuck",
        "full",
        "australienne",
        "unilateral",
        "unilatéral",
        "street"
    ]
};

function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function includesAnyKeyword(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
}

function computePopularity(typeNameFr, variationNameFr) {
    const profile = TYPE_PROFILES_BY_FR_NAME[typeNameFr] || FALLBACK_PROFILE;
    const score = { ...profile };
    const text = (variationNameFr || "").toLowerCase();

    if (includesAnyKeyword(text, KEYWORDS.machine)) {
        score.external_machine += 14;
        score.external_free -= 6;
        score.bodyweight_plus_external -= 8;
    }

    if (includesAnyKeyword(text, KEYWORDS.free)) {
        score.external_free += 12;
        score.external_machine -= 6;
    }

    if (includesAnyKeyword(text, KEYWORDS.bodyweight)) {
        score.bodyweight_plus_external += 12;
        score.external_machine -= 4;
    }

    if (text.includes("inclinaison")) {
        score.external_free += 8;
        score.external_machine += 4;
        score.bodyweight_plus_external -= 10;
    }

    if (typeNameFr === "Gêne / douleur / blessure") {
        score.global = 10;
    }

    // Avoid over-prioritizing gymnastic progression labels in generic bodyweight flows.
    if (typeNameFr === "Variante Street Workout" && /(tuck|full|advanced tuck)/i.test(text)) {
        score.bodyweight_plus_external -= 20;
        score.global -= 8;
    }

    // Keep machine brands discoverable without flooding the whole top list.
    if (typeNameFr === "Marque de machine") {
        score.global -= 6;
        score.external_machine = Math.min(score.external_machine, 62);
    }

    // Keep global as a high-level editorial prior, with a tiny drift from context levels.
    const contextualMean = (score.bodyweight_plus_external + score.external_free + score.external_machine) / 3;
    score.global = (profile.global * 0.85) + (contextualMean * 0.15);

    return {
        global: clamp(score.global),
        bodyweight_plus_external: clamp(score.bodyweight_plus_external),
        external_free: clamp(score.external_free),
        external_machine: clamp(score.external_machine)
    };
}

async function backfillDetailPopularityByWeightType() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(databaseName);
        const variationsCollection = db.collection("variations");
        const typesCollection = db.collection("types");

        const types = await typesCollection.find({}, { projection: { "name.fr": 1 } }).toArray();
        const typeById = new Map(types.map((t) => [String(t._id), t?.name?.fr || ""]));

        const details = await variationsCollection.find(
            { isExercice: false },
            { projection: { _id: 1, type: 1, "name.fr": 1, popularity: 1 } }
        ).toArray();

        console.log(`Found ${details.length} detail variations.`);

        let modifiedCount = 0;
        const preview = [];

        for (const detail of details) {
            const typeNameFr = typeById.get(String(detail.type)) || "";
            const nameFr = detail?.name?.fr || "";
            const popularity = computePopularity(typeNameFr, nameFr);

            if (preview.length < 20) {
                preview.push({
                    _id: String(detail._id),
                    nameFr,
                    typeNameFr,
                    popularity
                });
            }

            if (APPLY_MODE) {
                const result = await variationsCollection.updateOne(
                    { _id: detail._id },
                    { $set: { popularity } }
                );
                modifiedCount += result.modifiedCount;
            }
        }

        console.log(`Mode: ${APPLY_MODE ? "APPLY" : "DRY-RUN"}`);
        console.log("Preview (first 20):");
        console.log(JSON.stringify(preview, null, 2));

        if (APPLY_MODE) {
            console.log(`Modified detail variations: ${modifiedCount}`);
        } else {
            console.log("No DB write performed. Re-run with --apply to persist scores.");
        }
    } catch (error) {
        console.error("Error while backfilling detail popularity:", error);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

backfillDetailPopularityByWeightType();
