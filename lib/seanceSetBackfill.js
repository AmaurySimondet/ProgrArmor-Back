const mongoose = require("mongoose");
const SeanceSet = require("../schema/seanceset");
const Variation = require("../schema/variation");
const UserMeasure = require("../schema/userMeasure");
const {
    resolveUserWeightKgForDate,
    computePersistedBodyweightFields,
    buildSeanceSetDateQuery,
} = require("../utils/userMeasureTimeline");

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

/**
 * @param {string} userId
 * @param {{ fullRefresh?: boolean, dateFrom?: Date, dateTo?: Date, dateRanges?: Array<{dateFrom:Date,dateTo:Date|null}> }} [options]
 */
async function backfillSeanceSetsForUser(userId, options = {}) {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return { updatedCount: 0, scannedCount: 0 };
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const userMeasures = await UserMeasure.find(
        { userId: userObjectId },
        { measuredAt: 1, "weight.kg": 1 }
    ).sort({ measuredAt: 1 }).lean();

    if (!userMeasures.length) {
        return { updatedCount: 0, scannedCount: 0 };
    }

    const fullRefresh = options.fullRefresh === true;
    const hasScopedRange = Boolean(
        options.dateRanges?.length || options.dateFrom || options.dateTo
    );

    if (!fullRefresh && !hasScopedRange) {
        return { updatedCount: 0, scannedCount: 0 };
    }

    const filter = { user: userObjectId };
    if (!fullRefresh) {
        if (options.dateRanges?.length) {
            Object.assign(filter, buildSeanceSetDateQuery(options.dateRanges));
        } else {
            const date = {};
            if (options.dateFrom) date.$gte = options.dateFrom;
            if (options.dateTo) date.$lt = options.dateTo;
            filter.date = date;
        }
    }

    const docs = await SeanceSet.find(filter).lean();
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

    const ops = [];
    for (const doc of docs) {
        const policy = policyBySignature.get(signatureBySet.get(String(doc._id)))
            || { includeBodyweight: false, ratio: 1 };
        const userWeightKg = policy.includeBodyweight
            ? resolveUserWeightKgForDate(userMeasures, doc.date)
            : null;

        const fields = computePersistedBodyweightFields(doc, { policy, userWeightKg });

        ops.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: fields },
            },
        });
    }

    if (ops.length) await SeanceSet.bulkWrite(ops, { ordered: false });
    return { updatedCount: ops.length, scannedCount: docs.length };
}

module.exports = {
    backfillSeanceSetsForUser,
    shouldIncludeBodyweightForVariationDocs,
    getExerciseBodyWeightRatioForVariationDocs,
};
