/**
 * Usage:
 *   node oneShotQueries/testTimeseriesContextualMapping.js
 *   node oneShotQueries/testTimeseriesContextualMapping.js <userId> <mainExerciseId> <dateMin> [referenceVariationId]
 */
const mongoose = require("mongoose");
require("dotenv").config();

const setLib = require("../lib/set");
const Variation = require("../schema/variation");
const Set = require("../schema/seanceset");
const {
    getDifficultyRatio,
    buildAdjacencyList,
    resolveCanonicalVariationIdFromIds,
} = require("../lib/variationDifficultyGraph");

const DEFAULT_USER_ID = "6365489f44d4b4000470882b";
const DEFAULT_MAIN_EXERCISE_ID = "692214541c858345acc2d42c"; // tuck back lever
const DEFAULT_DATE_MIN = "2025-11-06";
const DEFAULT_REFERENCE_VARIATION_ID = "669c3609218324e0b7682b2b"; // tuck
const FOCUS_SET_ID = "69f9dbac645ba1b8f3511fdb"; // back lever + advanced tuck

function toSortedSignature(ids) {
    return [...ids].map((id) => String(id)).sort().join("|");
}

async function resolveMainExerciseIdForProgression(mainExerciseId) {
    if (!mainExerciseId || !mongoose.Types.ObjectId.isValid(mainExerciseId)) return null;
    const doc = await Variation.findById(String(mainExerciseId), { equivalentTo: 1 }).lean();
    const first = doc?.equivalentTo?.[0];
    return first ? String(first) : String(mainExerciseId);
}

async function resolveContextualReferenceVariationId(referenceVariationId, normalizedMainExerciseId) {
    const refId = mongoose.Types.ObjectId.isValid(referenceVariationId) ? String(referenceVariationId) : null;
    const mainId = mongoose.Types.ObjectId.isValid(normalizedMainExerciseId) ? String(normalizedMainExerciseId) : null;
    if (!refId || !mainId || refId === mainId) return refId;
    const contextual = await Variation.findOne(
        {
            verified: true,
            equivalentTo: {
                $size: 2,
                $all: [new mongoose.Types.ObjectId(mainId), new mongoose.Types.ObjectId(refId)],
            },
        },
        { _id: 1 }
    ).sort({ popularity: -1, createdAt: 1 }).lean();
    return contextual?._id ? String(contextual._id) : refId;
}

async function resolveContextualSourceVariationId(sourceVariationIds, normalizedMainExerciseId) {
    const ids = (sourceVariationIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length) return null;
    const mainId = mongoose.Types.ObjectId.isValid(normalizedMainExerciseId) ? String(normalizedMainExerciseId) : null;
    const objectIds = ids
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    if (objectIds.length === ids.length && ids.length > 1) {
        const combo = await Variation.findOne(
            { equivalentTo: { $size: ids.length, $all: objectIds } },
            { _id: 1, verified: 1, popularity: 1, createdAt: 1 }
        ).sort({ verified: -1, popularity: -1, createdAt: 1 }).lean();
        if (combo?._id) return String(combo._id);
    }

    if (mainId && ids.length === 1 && ids[0] !== mainId) {
        const combo = await Variation.findOne(
            {
                equivalentTo: {
                    $size: 2,
                    $all: [new mongoose.Types.ObjectId(mainId), new mongoose.Types.ObjectId(ids[0])],
                },
            },
            { _id: 1, verified: 1, popularity: 1, createdAt: 1 }
        ).sort({ verified: -1, popularity: -1, createdAt: 1 }).lean();
        if (combo?._id) return String(combo._id);
    }

    return null;
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) throw new Error("Missing MONGO_URL/mongoURL or DATABASE.");

    const userId = process.argv[2] || DEFAULT_USER_ID;
    const mainExerciseId = process.argv[3] || DEFAULT_MAIN_EXERCISE_ID;
    const dateMin = process.argv[4] || DEFAULT_DATE_MIN;
    const referenceVariationId = process.argv[5] || DEFAULT_REFERENCE_VARIATION_ID;

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    const timeseries = await setLib.getNormalizedProgressionTimeseries({
        userId,
        mainExerciseId,
        referenceVariations: referenceVariationId,
        dateMin,
        valueMin: 0
    });

    const points = Array.isArray(timeseries?.points) ? timeseries.points : [];
    const focusPoint = points.find((p) => String(p?.setId) === FOCUS_SET_ID);

    const normalizedMain = await resolveMainExerciseIdForProgression(mainExerciseId);
    const targetCanonicalRaw = await resolveCanonicalVariationIdFromIds([referenceVariationId]);
    const targetCanonical = await resolveContextualReferenceVariationId(targetCanonicalRaw, normalizedMain);
    const adjacency = await buildAdjacencyList({ contextVariationId: normalizedMain });

    const focusSet = await Set.findById(FOCUS_SET_ID, { variations: 1 }).lean();
    const sourceVariationIds = (focusSet?.variations || [])
        .map((v) => (v?.variation ? String(v.variation) : null))
        .filter(Boolean);
    const sourceCanonical = sourceVariationIds.length > 0
        ? (await resolveCanonicalVariationIdFromIds(sourceVariationIds)) || sourceVariationIds[0]
        : null;
    const sourceContextual = await resolveContextualSourceVariationId(sourceVariationIds, normalizedMain);
    const sourceDetail = sourceVariationIds.find((id) => String(id) !== String(normalizedMain)) || null;

    const candidates = [
        ["contextual", sourceContextual],
        ["detail", sourceDetail],
        ["canonical", sourceCanonical],
    ];

    const candidateResults = [];
    for (const [kind, fromId] of candidates) {
        if (!fromId || !targetCanonical) {
            candidateResults.push({ kind, fromId, ratio: null, path: [], hops: null, reason: "MISSING_INPUT" });
            continue;
        }
        const diff = await getDifficultyRatio({
            fromVariationId: fromId,
            toVariationId: targetCanonical,
            contextVariationId: normalizedMain,
            adjacency
        });
        candidateResults.push({
            kind,
            fromId,
            toId: targetCanonical,
            ratio: diff?.ratio ?? null,
            path: diff?.path || [],
            hops: diff?.hops ?? null,
            reason: diff?.reason || null
        });
    }

    console.log("=== Input ===");
    console.log({ userId, mainExerciseId, dateMin, referenceVariationId });
    console.log("=== Target Resolution ===");
    console.log({ normalizedMain, targetCanonicalRaw, targetCanonical });
    console.log("=== Focus Set Raw Variations ===");
    console.log({ focusSetId: FOCUS_SET_ID, sourceVariationIds, signature: toSortedSignature(sourceVariationIds) });
    console.log("=== Candidate Graph Resolution ===");
    console.log(candidateResults);
    console.log("=== Focus Point In Timeseries ===");
    console.log(focusPoint || null);
}

run()
    .catch((err) => {
        console.error("Test failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

