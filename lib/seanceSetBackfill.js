const mongoose = require("mongoose");
const SeanceSet = require("../schema/seanceset");
const Variation = require("../schema/variation");
const UserMeasure = require("../schema/userMeasure");
const { computeSetOneRepMaxEstimates, getEffectiveLoadKg } = require("../utils/oneRepMax");
const { KG_TO_LB, round2 } = require("../utils/seanceSetPersistedFields");

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

function getVariationIdsFromSetDoc(setDoc) {
    return (setDoc?.variations || [])
        .map((v) => (v?.variation != null ? String(v.variation) : null))
        .filter(Boolean);
}

function getVariationSignature(ids) {
    return [...ids].sort().join("|");
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

async function backfillSeanceSetsForUser(userId) {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return { updatedCount: 0, scannedCount: 0 };
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const docs = await SeanceSet.find({ user: userObjectId }).lean();
    if (!docs.length) {
        return { updatedCount: 0, scannedCount: 0 };
    }

    const allVarIds = new Set();
    const signatureBySet = new Map();
    for (const doc of docs) {
        const ids = getVariationIdsFromSetDoc(doc);
        ids.forEach((id) => allVarIds.add(id));
        signatureBySet.set(String(doc._id), getVariationSignature(ids));
    }

    const variations = await Variation.find(
        { _id: { $in: Array.from(allVarIds) } },
        { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 }
    ).lean();
    const varById = new Map(variations.map((v) => [String(v._id), v]));

    const policyBySignature = new Map();
    for (const signature of new Set(signatureBySet.values())) {
        const ids = signature.split("|").filter(Boolean);
        const docsV = ids.map((id) => varById.get(id)).filter(Boolean);
        policyBySignature.set(signature, {
            includeBodyweight: shouldIncludeBodyweightForVariationDocs(docsV),
            ratio: getExerciseBodyWeightRatioForVariationDocs(docsV),
        });
    }

    const userMeasures = await UserMeasure.find(
        { userId: userObjectId },
        { measuredAt: 1, "weight.kg": 1 }
    ).sort({ measuredAt: 1 }).lean();

    const ops = [];
    for (const doc of docs) {
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
            const w = resolveUserWeightKgForDate(userMeasures || [], doc.date);
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

        ops.push({
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

    if (ops.length) await SeanceSet.bulkWrite(ops, { ordered: false });
    return { updatedCount: ops.length, scannedCount: docs.length };
}

module.exports = { backfillSeanceSetsForUser };
