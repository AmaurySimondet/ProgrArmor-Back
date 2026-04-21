/**
 * Usage:
 *   node oneShotQueries/backfillStaticExercisesBodyweightFields.js
 *
 * Scope:
 * - Variations de type "exercices" (669cee980c89e9434327caa8)
 * - exerciseBodyWeightRatio actuellement null
 *
 * Action:
 * - weightType => "bodyweight_plus_external"
 * - includeBodyweight => true
 * - exerciseBodyWeightRatio => valeur proposée individuellement
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");
const VariationProgressionEdge = require("../schema/variationProgressionEdge");
const SeanceSet = require("../schema/seanceset");
const UserMeasure = require("../schema/userMeasure");
const { computeSetOneRepMaxEstimates, getEffectiveLoadKg } = require("../utils/oneRepMax");
const { KG_TO_LB, round2 } = require("../utils/seanceSetPersistedFields");

const EXERCISE_TYPE_ID = "669cee980c89e9434327caa8";

// Propositions individuelles (idempotent: rejouable sans effet de bord inattendu)
// progressionEdge=true => on active la progression + upsert des variation edges associés.
const EXERCISE_CONFIG_BY_ID = {
    // Street workout statiques
    "669ced7e665a3ffe77714384": { ratio: 0.95, progressionEdge: true }, // Back Lever -> variationedge
    "669ced7e665a3ffe77714389": { ratio: 1.10, progressionEdge: false }, // Iron Cross
    "669ced7e665a3ffe77714388": { ratio: 0.90, progressionEdge: true }, // Human Flag -> variationedge
    "669ced7e665a3ffe7771438d": { ratio: 0.80, progressionEdge: true }, // Elbow Lever -> variationedge
    "669ced7e665a3ffe7771438e": { ratio: 0.60, progressionEdge: false }, // Frog Stand
    "669ced7e665a3ffe77714383": { ratio: 1.00, progressionEdge: true }, // Front Lever -> variationedge
    "69206771f94b17a153ce44ba": { ratio: 1.00, progressionEdge: false }, // Support Hold
    "669ced7e665a3ffe77714387": { ratio: 1.15, progressionEdge: true }, // Maltese -> variationedge
    "669ced7e665a3ffe7771438c": { ratio: 1.00, progressionEdge: false }, // Manna
    "669ced7e665a3ffe77714385": { ratio: 1.05, progressionEdge: true }, // Planche -> variationedge
    "669ced7e665a3ffe77714390": { ratio: 1.20, progressionEdge: true }, // Victorian -> variationedge

    // Handstand / équilibres
    "692214541c858345acc2d405": { ratio: 0.78, progressionEdge: false }, // Free Handstand
    "692214541c858345acc2d402": { ratio: 0.75, progressionEdge: false }, // Handstand Wall Hold (Chest-to-wall)
    "692214541c858345acc2d408": { ratio: 0.95, progressionEdge: false }, // One Arm Handstand
    "692214541c858345acc2d3ff": { ratio: 0.55, progressionEdge: false }, // Headstand
    "692214541c858345acc2d3fc": { ratio: 0.65, progressionEdge: false }, // Crow Pose
};

const DETAILS_ORDER = [
    "tuck",
    "advanced tuck",
    "one leg",
    "advanced one leg",
    "one leg half",
    "half lay",
    "open hip straddle",
    "closed hip straddle",
    "full"
];

const DETAIL_INTENSITY_COEFFICIENTS = {
    tuck: 1.0,
    "advanced tuck": 1.15,
    "one leg": 1.35,
    "advanced one leg": 1.48,
    "one leg half": 1.56,
    "half lay": 1.65,
    "open hip straddle": 1.8,
    "closed hip straddle": 1.9,
    full: 2.05
};

function getVariationIdsFromSetDoc(setDoc) {
    return (setDoc?.variations || [])
        .map((v) => (v?.variation != null ? String(v.variation) : null))
        .filter(Boolean);
}

function getVariationSignature(ids) {
    return [...ids].sort().join("|");
}

function shouldIncludeBodyweightForVariationDocs(variationDocs) {
    const exercises = (variationDocs || []).filter((v) => v?.isExercice === true);
    return exercises.length > 0 && exercises.every((v) => v?.includeBodyweight === true);
}

function getExerciseBodyWeightRatioForVariationDocs(variationDocs) {
    const exercises = (variationDocs || []).filter((v) => v?.isExercice === true);
    const ratios = exercises
        .map((v) => Number(v?.exerciseBodyWeightRatio))
        .filter((r) => Number.isFinite(r) && r > 0);
    if (!ratios.length) return 1;
    return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

function resolveUserWeightKgForDate(userMeasures, date) {
    if (!Array.isArray(userMeasures) || !userMeasures.length) return null;
    const targetMs = new Date(date || Date.now()).getTime();
    let latest = null;
    for (const m of userMeasures) {
        const at = new Date(m?.measuredAt).getTime();
        if (!Number.isFinite(at)) continue;
        if (at <= targetMs) latest = m;
        else break;
    }
    const chosen = latest ?? userMeasures[userMeasures.length - 1];
    const kg = chosen?.weight?.kg;
    return Number.isFinite(Number(kg)) ? Number(kg) : null;
}

function normalizeLabel(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function inferDetailOrderFromName(name) {
    const n = normalizeLabel(name);
    if (n.includes("advanced one leg")) return DETAILS_ORDER.indexOf("advanced one leg");
    if (n.includes("closed hip straddle")) return DETAILS_ORDER.indexOf("closed hip straddle");
    if (n.includes("one leg half")) return DETAILS_ORDER.indexOf("one leg half");
    if (n.includes("advanced tuck")) return DETAILS_ORDER.indexOf("advanced tuck");
    if (n.includes("open hip straddle")) return DETAILS_ORDER.indexOf("open hip straddle");
    if (n.includes("half lay")) return DETAILS_ORDER.indexOf("half lay");
    if (n.includes("full")) return DETAILS_ORDER.indexOf("full");
    if (n.includes("one leg")) return DETAILS_ORDER.indexOf("one leg");
    if (n.includes("straddle")) return DETAILS_ORDER.indexOf("open hip straddle");
    if (n.includes("tuck")) return DETAILS_ORDER.indexOf("tuck");
    return null;
}

function ratioByDetailDistance(fromIdx, toIdx) {
    const fromKey = DETAILS_ORDER[fromIdx];
    const toKey = DETAILS_ORDER[toIdx];
    const fromCoeff = DETAIL_INTENSITY_COEFFICIENTS[fromKey];
    const toCoeff = DETAIL_INTENSITY_COEFFICIENTS[toKey];
    if (!Number.isFinite(fromCoeff) || !Number.isFinite(toCoeff) || fromCoeff <= 0) return null;
    return Math.round(((toCoeff / fromCoeff) + Number.EPSILON) * 1000) / 1000;
}

async function buildProgressionEdgesForMarkedExercises(markedBaseExerciseIds) {
    if (!Array.isArray(markedBaseExerciseIds) || markedBaseExerciseIds.length === 0) return [];
    const baseObjectIds = markedBaseExerciseIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    if (!baseObjectIds.length) return [];

    const docs = await Variation.find(
        {
            isExercice: true,
            $or: [
                { _id: { $in: baseObjectIds } },
                { equivalentTo: { $in: baseObjectIds } }
            ]
        },
        { _id: 1, equivalentTo: 1, "name.fr": 1, "name.en": 1 }
    ).lean();

    const byBase = new Map(markedBaseExerciseIds.map((id) => [String(id), []]));
    for (const doc of docs) {
        const docId = String(doc._id);
        const equivalentIds = Array.isArray(doc?.equivalentTo) ? doc.equivalentTo.map((id) => String(id)) : [];
        for (const baseId of markedBaseExerciseIds) {
            if (docId === String(baseId) || equivalentIds.includes(String(baseId))) {
                byBase.get(String(baseId)).push(doc);
            }
        }
    }

    const edges = [];
    for (const [baseId, list] of byBase.entries()) {
        const ordered = list
            .map((doc) => ({
                ...doc,
                detailOrderIdx: inferDetailOrderFromName(doc?.name?.en || doc?.name?.fr || "")
            }))
            .filter((doc) => Number.isInteger(doc.detailOrderIdx))
            .sort((a, b) => a.detailOrderIdx - b.detailOrderIdx);

        for (let i = 0; i < ordered.length - 1; i += 1) {
            const from = ordered[i];
            const to = ordered[i + 1];
            const ratio = ratioByDetailDistance(from.detailOrderIdx, to.detailOrderIdx);
            if (!Number.isFinite(ratio) || ratio <= 0) continue;
            edges.push({
                fromVariationId: from._id,
                fromVariationName: from?.name?.fr || from?.name?.en || "",
                toVariationId: to._id,
                toVariationName: to?.name?.fr || to?.name?.en || "",
                isExerciseVariation: true,
                difficultyRatio: ratio,
                confidence: "medium",
                source: "manual",
                contextVariationId: new mongoose.Types.ObjectId(baseId),
                notes: "Static exercise progression inferred by detail order",
                isActive: true
            });
        }
    }

    return edges;
}

async function upsertProgressionEdges(edges) {
    let upserted = 0;
    for (const edge of edges) {
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
    return upserted;
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }

    await mongoose.connect(mongoUrl + database);

    const configuredIds = Object.keys(EXERCISE_CONFIG_BY_ID);
    const filter = {
        type: new mongoose.Types.ObjectId(EXERCISE_TYPE_ID),
        _id: { $in: configuredIds.map((id) => new mongoose.Types.ObjectId(id)) }
    };

    const candidates = await Variation.find(
        filter,
        { _id: 1, "name.fr": 1, "name.en": 1 }
    ).lean();

    const foundIds = new global.Set(candidates.map((v) => String(v._id)));
    const missingInDb = configuredIds.filter((id) => !foundIds.has(String(id)));
    if (missingInDb.length > 0) {
        console.log("IDs configurés introuvables en base, backfill annulé pour sécurité:");
        console.log(missingInDb);
        process.exitCode = 1;
        return;
    }

    const ops = candidates.map((v) => {
        const id = String(v._id);
        const cfg = EXERCISE_CONFIG_BY_ID[id];
        const ratio = Number(cfg?.ratio);
        return {
            updateOne: {
                filter: { _id: v._id },
                update: {
                    $set: {
                        weightType: "bodyweight_plus_external",
                        includeBodyweight: true,
                        exerciseBodyWeightRatio: ratio,
                        possibleProgression: cfg?.progressionEdge === true
                    }
                }
            }
        };
    });

    let result = { matchedCount: 0, modifiedCount: 0 };
    if (ops.length) {
        result = await Variation.bulkWrite(ops, { ordered: false });
    }

    const markedExerciseIds = configuredIds.filter((id) => EXERCISE_CONFIG_BY_ID[id]?.progressionEdge === true);
    const progressionEdges = await buildProgressionEdgesForMarkedExercises(markedExerciseIds);
    const progressionEdgesUpserted = await upsertProgressionEdges(progressionEdges);

    // Recalcul des champs persistés des sets impactés (bodyweight + ratio)
    const candidateIds = configuredIds;
    const impactedSets = await SeanceSet.find({
        "variations.variation": { $in: candidateIds.map((id) => new mongoose.Types.ObjectId(id)) }
    }).lean();

    const allVarIds = new global.Set();
    const allUserIds = new global.Set();
    const signatureBySet = new Map();
    for (const doc of impactedSets) {
        allUserIds.add(String(doc.user));
        const ids = getVariationIdsFromSetDoc(doc);
        ids.forEach((id) => allVarIds.add(id));
        signatureBySet.set(String(doc._id), getVariationSignature(ids));
    }

    const variations = await Variation.find(
        { _id: { $in: Array.from(allVarIds).map((id) => new mongoose.Types.ObjectId(id)) } },
        { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 }
    ).lean();
    const varById = new Map(variations.map((v) => [String(v._id), v]));

    const policyBySignature = new Map();
    for (const signature of new global.Set(signatureBySet.values())) {
        const ids = signature.split("|").filter(Boolean);
        const docsV = ids.map((id) => varById.get(id)).filter(Boolean);
        policyBySignature.set(signature, {
            includeBodyweight: shouldIncludeBodyweightForVariationDocs(docsV),
            ratio: getExerciseBodyWeightRatioForVariationDocs(docsV),
        });
    }

    const measuresByUser = new Map();
    for (const userId of allUserIds) {
        const rows = await UserMeasure.find(
            { userId: new mongoose.Types.ObjectId(userId) },
            { measuredAt: 1, "weight.kg": 1 }
        ).sort({ measuredAt: 1 }).lean();
        measuresByUser.set(userId, rows);
    }

    const setOps = [];
    for (const doc of impactedSets) {
        const policy = policyBySignature.get(signatureBySet.get(String(doc._id))) || { includeBodyweight: false, ratio: 1 };
        const effectiveWeightLoad = round2(getEffectiveLoadKg(doc));
        const effectiveWeightLoadLbs = effectiveWeightLoad != null ? round2(effectiveWeightLoad * KG_TO_LB) : null;
        const weightLoadLbs = Number.isFinite(Number(doc.weightLoad)) ? round2(Number(doc.weightLoad) * KG_TO_LB) : null;

        let oneRepMaxIncludesBodyweight = false;
        let oneRepMaxUserWeightKg = null;
        let oneRepMaxExerciseBodyWeightRatio = null;
        let effectiveWeightLoadWithBodyweight = null;
        let effectiveWeightLoadWithBodyweightLbs = null;
        let brzyckiWithBodyweight = null;
        let epleyWithBodyweight = null;
        let { brzycki, epley } = computeSetOneRepMaxEstimates(doc);

        if (policy.includeBodyweight) {
            const w = resolveUserWeightKgForDate(measuresByUser.get(String(doc.user)) || [], doc.date);
            if (Number.isFinite(Number(w)) && w > 0) {
                const weighted = Number(w) * Number(policy.ratio || 1);
                oneRepMaxIncludesBodyweight = true;
                oneRepMaxUserWeightKg = Number(w);
                oneRepMaxExerciseBodyWeightRatio = Number(policy.ratio || 1);
                effectiveWeightLoadWithBodyweight = round2(getEffectiveLoadKg(doc, { includeBodyweight: true, userWeightKg: weighted }));
                effectiveWeightLoadWithBodyweightLbs = effectiveWeightLoadWithBodyweight != null
                    ? round2(effectiveWeightLoadWithBodyweight * KG_TO_LB) : null;
                const withBw = computeSetOneRepMaxEstimates({
                    ...doc,
                    weightLoad: effectiveWeightLoadWithBodyweight,
                    elastic: null,
                });
                brzyckiWithBodyweight = withBw.brzycki;
                epleyWithBodyweight = withBw.epley;
                brzycki = brzyckiWithBodyweight != null ? round2(brzyckiWithBodyweight - weighted) : null;
                epley = epleyWithBodyweight != null ? round2(epleyWithBodyweight - weighted) : null;
            } else {
                brzycki = null;
                epley = null;
            }
        }

        setOps.push({
            updateOne: {
                filter: { _id: doc._id },
                update: {
                    $set: {
                        effectiveWeightLoad,
                        effectiveWeightLoadWithBodyweight,
                        weightLoadLbs,
                        effectiveWeightLoadLbs,
                        effectiveWeightLoadWithBodyweightLbs,
                        brzycki,
                        epley,
                        oneRepMaxIncludesBodyweight,
                        oneRepMaxUserWeightKg,
                        oneRepMaxExerciseBodyWeightRatio,
                        brzyckiWithBodyweight,
                        epleyWithBodyweight,
                    },
                },
            },
        });
    }

    if (setOps.length) {
        await SeanceSet.bulkWrite(setOps, { ordered: false });
    }

    console.log("Backfill terminé.");
    console.log(`- matched: ${result.matchedCount || 0}`);
    console.log(`- modified: ${result.modifiedCount || 0}`);
    console.log(`- progression edges upserted: ${progressionEdgesUpserted}`);
    console.log(`- sets impactés scannés: ${impactedSets.length}`);
    console.log(`- sets recalculés: ${setOps.length}`);
    console.log("- ratios/progression appliqués:");
    for (const v of candidates) {
        const id = String(v._id);
        const cfg = EXERCISE_CONFIG_BY_ID[id];
        console.log(
            `  ${id} | ${v?.name?.fr || v?.name?.en || "unknown"} => ratio:${cfg?.ratio} progression:${cfg?.progressionEdge === true}`
        );
    }
}

run()
    .catch((err) => {
        console.error("Backfill failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

