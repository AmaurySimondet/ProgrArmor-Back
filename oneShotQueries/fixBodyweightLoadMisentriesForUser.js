/**
 * Corrige des saisies historiques erronées sur des exercices au poids du corps
 * (tractions/dips enregistrés avec une charge externe élevée).
 *
 * Ciblage:
 * - user: 67af4613b20cf00003a492c6
 * - weightLoad >= 50
 * - variations.variation in [669ced7e665a3ffe77714379, 669ced7e665a3ffe7771437b]
 *
 * Effet:
 * - force weightLoad à 0
 * - recalcule les champs persistés associés:
 *   brzycki, epley,
 *   effectiveWeightLoad, weightLoadLbs, effectiveWeightLoadLbs,
 *   oneRepMaxIncludesBodyweight, oneRepMaxUserWeightKg, oneRepMaxExerciseBodyWeightRatio,
 *   brzyckiWithBodyweight, epleyWithBodyweight,
 *   effectiveWeightLoadWithBodyweight, effectiveWeightLoadWithBodyweightLbs
 *
 * Usage:
 *   node oneShotQueries/fixBodyweightLoadMisentriesForUser.js
 *   node oneShotQueries/fixBodyweightLoadMisentriesForUser.js --apply
 */
const mongoose = require("mongoose");
require("dotenv").config();

const SeanceSet = require("../schema/seanceset");
const Variation = require("../schema/variation");
const UserMeasure = require("../schema/userMeasure");
const { computeSetOneRepMaxEstimates, getEffectiveLoadKg } = require("../utils/oneRepMax");
const { KG_TO_LB, round2 } = require("../utils/seanceSetPersistedFields");

const TARGET_USER_ID = "67af4613b20cf00003a492c6"; // Florian
const TARGET_VARIATION_IDS = [
    "669ced7e665a3ffe77714379", // Tractions
    "669ced7e665a3ffe7771437b", // Dips
];
const MIN_WRONG_WEIGHT_LOAD = 50;

function oid(id) {
    return new mongoose.Types.ObjectId(id);
}

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }
    return mongoUrl + database;
}

function variationIdsFromDoc(doc) {
    return (doc?.variations || [])
        .map((v) => (v?.variation != null ? String(v.variation) : null))
        .filter(Boolean);
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

function computePersistedFieldsFromCorrectedDoc(doc, variationDocs, userMeasures) {
    const docWithFixedWeight = { ...doc, weightLoad: 0 };

    const effectiveWeightLoad = round2(getEffectiveLoadKg(docWithFixedWeight));
    const effectiveWeightLoadLbs = effectiveWeightLoad != null ? round2(effectiveWeightLoad * KG_TO_LB) : null;
    const weightLoadLbs = round2(0);

    let { brzycki, epley } = computeSetOneRepMaxEstimates(docWithFixedWeight);
    let oneRepMaxIncludesBodyweight = false;
    let oneRepMaxUserWeightKg = null;
    let oneRepMaxExerciseBodyWeightRatio = null;
    let effectiveWeightLoadWithBodyweight = null;
    let effectiveWeightLoadWithBodyweightLbs = null;
    let brzyckiWithBodyweight = null;
    let epleyWithBodyweight = null;

    const includeBodyweight = shouldIncludeBodyweightForVariationDocs(variationDocs);
    if (includeBodyweight) {
        const ratio = getExerciseBodyWeightRatioForVariationDocs(variationDocs);
        const userWeightKg = resolveUserWeightKgForDate(userMeasures, doc.date);

        if (Number.isFinite(Number(userWeightKg)) && userWeightKg > 0) {
            const weightedBodyweight = Number(userWeightKg) * Number(ratio || 1);
            oneRepMaxIncludesBodyweight = true;
            oneRepMaxUserWeightKg = Number(userWeightKg);
            oneRepMaxExerciseBodyWeightRatio = Number(ratio || 1);

            effectiveWeightLoadWithBodyweight = round2(
                getEffectiveLoadKg(docWithFixedWeight, { includeBodyweight: true, userWeightKg: weightedBodyweight })
            );
            effectiveWeightLoadWithBodyweightLbs = effectiveWeightLoadWithBodyweight != null
                ? round2(effectiveWeightLoadWithBodyweight * KG_TO_LB)
                : null;

            const withBw = computeSetOneRepMaxEstimates({
                ...docWithFixedWeight,
                weightLoad: effectiveWeightLoadWithBodyweight,
                elastic: null,
            });
            brzyckiWithBodyweight = withBw.brzycki;
            epleyWithBodyweight = withBw.epley;
            brzycki = brzyckiWithBodyweight != null ? round2(brzyckiWithBodyweight - weightedBodyweight) : null;
            epley = epleyWithBodyweight != null ? round2(epleyWithBodyweight - weightedBodyweight) : null;
        } else {
            brzycki = null;
            epley = null;
        }
    }

    return {
        weightLoad: 0,
        weightLoadLbs,
        effectiveWeightLoad,
        effectiveWeightLoadLbs,
        brzycki,
        epley,
        oneRepMaxIncludesBodyweight,
        oneRepMaxUserWeightKg,
        oneRepMaxExerciseBodyWeightRatio,
        brzyckiWithBodyweight,
        epleyWithBodyweight,
        effectiveWeightLoadWithBodyweight,
        effectiveWeightLoadWithBodyweightLbs,
    };
}

async function run() {
    const shouldApply = process.argv.includes("--apply");
    await mongoose.connect(getMongoUri());

    try {
        const filter = {
            user: oid(TARGET_USER_ID),
            weightLoad: { $gte: MIN_WRONG_WEIGHT_LOAD },
            "variations.variation": { $in: TARGET_VARIATION_IDS.map(oid) },
        };

        const docs = await SeanceSet.find(filter).lean();
        console.log("=== Fix bodyweight load misentries ===");
        console.log({
            applyMode: shouldApply,
            targetUserId: TARGET_USER_ID,
            targetVariationIds: TARGET_VARIATION_IDS,
            minWrongWeightLoad: MIN_WRONG_WEIGHT_LOAD,
            matchedSets: docs.length,
        });

        if (!docs.length) {
            console.log("Aucun set ciblé.");
            return;
        }

        const allVarIds = [...new Set(docs.flatMap(variationIdsFromDoc))];
        const variationDocs = await Variation.find(
            { _id: { $in: allVarIds.map(oid) } },
            { _id: 1, isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1, "name.fr": 1 }
        ).lean();
        const varById = new Map(variationDocs.map((v) => [String(v._id), v]));

        const userMeasures = await UserMeasure.find(
            { userId: oid(TARGET_USER_ID) },
            { measuredAt: 1, "weight.kg": 1 }
        ).sort({ measuredAt: 1 }).lean();

        const preview = docs.slice(0, 10).map((doc) => {
            const docVarDocs = variationIdsFromDoc(doc).map((id) => varById.get(id)).filter(Boolean);
            const next = computePersistedFieldsFromCorrectedDoc(doc, docVarDocs, userMeasures);
            return {
                setId: String(doc._id),
                date: doc.date,
                reps: doc.reps,
                oldWeightLoad: doc.weightLoad,
                newWeightLoad: next.weightLoad,
                oldEffectiveWeightLoad: doc.effectiveWeightLoad ?? null,
                newEffectiveWeightLoad: next.effectiveWeightLoad,
                oldBrzycki: doc.brzycki ?? null,
                newBrzycki: next.brzycki,
                oldEpley: doc.epley ?? null,
                newEpley: next.epley,
            };
        });
        console.log("Preview (10 max):");
        console.log(preview);

        if (!shouldApply) {
            console.log("Dry-run only. Relancer avec --apply pour persister.");
            return;
        }

        const ops = docs.map((doc) => {
            const docVarDocs = variationIdsFromDoc(doc).map((id) => varById.get(id)).filter(Boolean);
            const persisted = computePersistedFieldsFromCorrectedDoc(doc, docVarDocs, userMeasures);
            return {
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: persisted },
                },
            };
        });

        const result = await SeanceSet.bulkWrite(ops, { ordered: false });
        console.log("=== Apply Result ===");
        console.log({
            matched: result.matchedCount || 0,
            modified: result.modifiedCount || 0,
        });
    } catch (error) {
        console.error("fixBodyweightLoadMisentriesForUser failed:", error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

run();
