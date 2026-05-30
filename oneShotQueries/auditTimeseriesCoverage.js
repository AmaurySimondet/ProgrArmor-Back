/**
 * Audit couverture graphe pour timeseries (sets "split" vs "combo").
 *
 * Usage:
 *   node oneShotQueries/auditTimeseriesCoverage.js
 *   node oneShotQueries/auditTimeseriesCoverage.js <userId> <mainExerciseId> <dateMin> [referenceVariationId]
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Set = require("../schema/seanceset");
const Variation = require("../schema/variation");
const {
    getDifficultyRatio,
    buildAdjacencyList,
    resolveCanonicalVariationIdFromIds,
    toSortedSignature
} = require("../lib/variationDifficultyGraph");

const DEFAULT_USER_ID = "6365489f44d4b4000470882b";
const DEFAULT_MAIN_EXERCISE_ID = "692214541c858345acc2d42c"; // tuck back lever
const DEFAULT_DATE_MIN = "2025-11-06";
const DEFAULT_REFERENCE_VARIATION_ID = "669c3609218324e0b7682b2b"; // tuck (generic)

function getVariationIdsFromSetDoc(setDoc) {
    return (setDoc?.variations || [])
        .map((v) => (v?.variation ? String(v.variation) : null))
        .filter(Boolean);
}

const { resolveFamilyAnchorId } = require("../lib/progressionResolution");

async function resolveMainExerciseIdForProgression(mainExerciseId) {
    if (!mainExerciseId || !mongoose.Types.ObjectId.isValid(mainExerciseId)) return null;
    const doc = await Variation.findById(String(mainExerciseId), { equivalentTo: 1, isExercice: 1 }).lean();
    return resolveFamilyAnchorId({ variationId: String(mainExerciseId), variationDoc: doc });
}

async function resolveContextualReferenceVariationId(referenceVariationId, normalizedMainExerciseId) {
    const refId = mongoose.Types.ObjectId.isValid(referenceVariationId) ? String(referenceVariationId) : null;
    const mainId = mongoose.Types.ObjectId.isValid(normalizedMainExerciseId) ? String(normalizedMainExerciseId) : null;
    if (!refId) return null;
    if (!mainId || refId === mainId) return refId;
    const combo = await Variation.findOne(
        {
            verified: true,
            equivalentTo: {
                $size: 2,
                $all: [new mongoose.Types.ObjectId(mainId), new mongoose.Types.ObjectId(refId)]
            }
        },
        { _id: 1 }
    )
        .sort({ popularity: -1, createdAt: 1 })
        .lean();
    return combo?._id ? String(combo._id) : refId;
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
        )
            .sort({ verified: -1, popularity: -1, createdAt: 1 })
            .lean();
        if (combo?._id) return String(combo._id);
    }

    if (mainId && ids.length === 1 && ids[0] !== mainId) {
        const combo = await Variation.findOne(
            {
                equivalentTo: {
                    $size: 2,
                    $all: [new mongoose.Types.ObjectId(mainId), new mongoose.Types.ObjectId(ids[0])]
                }
            },
            { _id: 1, verified: 1, popularity: 1, createdAt: 1 }
        )
            .sort({ verified: -1, popularity: -1, createdAt: 1 })
            .lean();
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

    const normalizedMainExerciseId = await resolveMainExerciseIdForProgression(mainExerciseId);
    const targetCanonicalRaw = await resolveCanonicalVariationIdFromIds([referenceVariationId]);
    const targetVariationId = await resolveContextualReferenceVariationId(
        targetCanonicalRaw,
        normalizedMainExerciseId
    );

    const rawSets = await Set.find(
        {
            user: new mongoose.Types.ObjectId(userId),
            value: { $gt: 0 },
            date: { $gte: new Date(dateMin) }
        },
        { _id: 1, date: 1, mergedVariationsNames: 1, variations: 1 }
    ).sort({ date: 1 }).lean();

    const sets = rawSets.filter((setDoc) => {
        const ids = getVariationIdsFromSetDoc(setDoc);
        return ids.includes(String(normalizedMainExerciseId))
            || ids.some((id) => String(id) === String(mainExerciseId));
    });

    const adjacency = await buildAdjacencyList({ contextVariationId: normalizedMainExerciseId });
    const missingGraph = [];
    const missingCombo = [];
    const ok = [];

    for (const setDoc of sets) {
        const sourceVariationIds = getVariationIdsFromSetDoc(setDoc);
        const sourceContextual = await resolveContextualSourceVariationId(sourceVariationIds, normalizedMainExerciseId);
        const sourceCanonical = await resolveCanonicalVariationIdFromIds(sourceVariationIds);
        const sourceDetail = sourceVariationIds.find((id) => id !== String(normalizedMainExerciseId)) || null;

        const sourceCandidates = [
            ["contextual", sourceContextual],
            ["detail", sourceDetail],
            ["canonical", sourceCanonical]
        ].filter(([, id]) => Boolean(id));

        let hit = null;
        const traces = [];
        for (const [kind, fromId] of sourceCandidates) {
            const d = await getDifficultyRatio({
                fromVariationId: fromId,
                toVariationId: targetVariationId,
                contextVariationId: normalizedMainExerciseId,
                adjacency
            });
            traces.push({ kind, fromId, ratio: d?.ratio ?? null, reason: d?.reason || null, hops: d?.hops ?? null });
            if (Number.isFinite(Number(d?.ratio)) && Number(d.ratio) > 0) {
                hit = { kind, fromId, ratio: Number(d.ratio), hops: d?.hops ?? null };
                break;
            }
        }

        const row = {
            setId: String(setDoc._id),
            date: setDoc?.date || null,
            merged: setDoc?.mergedVariationsNames || null,
            sourceVariationIds,
            signature: toSortedSignature(sourceVariationIds),
            sourceContextual,
            sourceDetail,
            sourceCanonical,
            traces
        };

        if (hit) {
            ok.push({ ...row, selected: hit });
        } else {
            if (!sourceContextual && sourceVariationIds.length > 1) {
                missingCombo.push(row);
            } else {
                missingGraph.push(row);
            }
        }
    }

    console.log("=== Input ===");
    console.log({ userId, mainExerciseId, normalizedMainExerciseId, dateMin, referenceVariationId });
    console.log("=== Target ===");
    console.log({ targetCanonicalRaw, targetVariationId });
    console.log("=== Summary ===");
    console.log({
        totalSetsInFamily: sets.length,
        resolvedWithGraph: ok.length,
        missingComboCount: missingCombo.length,
        missingGraphCount: missingGraph.length
    });
    console.log("=== Missing Combo (first 20) ===");
    console.log(missingCombo.slice(0, 20));
    console.log("=== Missing Graph (first 20) ===");
    console.log(missingGraph.slice(0, 20));
}

run()
    .catch((err) => {
        console.error("Audit failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

