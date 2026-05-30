/**
 * Usage:
 *   node oneShotQueries/testVariationProgressionTimeseriesCall.js
 *   node oneShotQueries/testVariationProgressionTimeseriesCall.js <userId> <mainExerciseId> [referenceVariationId]
 */
const mongoose = require("mongoose");
require("dotenv").config();

const setLib = require("../lib/set");
const Variation = require("../schema/variation");
const {
    resolveFamilyAnchorId,
    resolveTargetVariationId,
    isStreetFigureType,
    DEFAULT_REFERENCE_VARIATION_ID,
} = require("../lib/progressionResolution");

const DEFAULT_USER_ID = "6365489f44d4b4000470882b";
const DEFAULT_MAIN_EXERCISE_ID = "669ced7e665a3ffe7771437b"; // dips

const RESOLUTION_SAMPLES = [
    { label: "Dips", variationId: "669ced7e665a3ffe7771437b", expectTuck: false },
    { label: "Pull-ups", variationId: "669ced7e665a3ffe77714379", expectTuck: false },
    { label: "Human flag tuck (street figure type)", variationId: "692214541c858345acc2d435", expectTuck: true },
    { label: "V-Sit (explicit ref)", variationId: "669ced7e665a3ffe7771438b", expectTuck: false },
];

async function logResolutionSamples() {
    console.log("=== Resolution samples ===");
    for (const sample of RESOLUTION_SAMPLES) {
        const doc = await Variation.findById(sample.variationId, {
            type: 1,
            progressionReferenceVariationId: 1,
            equivalentTo: 1,
            isExercice: 1,
        }).lean();
        const targetVariationId = await resolveTargetVariationId({ variationId: sample.variationId, variationDoc: doc });
        const usesTuck = targetVariationId === DEFAULT_REFERENCE_VARIATION_ID;
        console.log({
            label: sample.label,
            familyAnchorId: await resolveFamilyAnchorId({ variationId: sample.variationId, variationDoc: doc }),
            targetVariationId,
            isStreetFigureType: isStreetFigureType(doc),
            expectTuck: sample.expectTuck,
            tuckOk: usesTuck === sample.expectTuck,
        });
    }
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }

    const userId = process.argv[2] || DEFAULT_USER_ID;
    const mainExerciseId = process.argv[3] || DEFAULT_MAIN_EXERCISE_ID;
    const referenceVariationId = process.argv[4] || DEFAULT_REFERENCE_VARIATION_ID; // tuck (street figure only)

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    await logResolutionSamples();

    const result = await setLib.getNormalizedProgressionTimeseries({
        userId,
        mainExerciseId,
        referenceVariations: referenceVariationId,
        dateMin: null,
        dateMax: null,
        unit: null,
        lateralMode: "bilateral",
    });

    const points = Array.isArray(result?.points) ? result.points : [];
    const byRatio = points.reduce((acc, p) => {
        const k = String(p?.difficultyRatioUsed);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});
    const byPathLength = points.reduce((acc, p) => {
        const k = String(Array.isArray(p?.path) ? p.path.length : 0);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});

    console.log("=== Input ===");
    console.log({ userId, mainExerciseId, referenceVariationId });
    console.log("=== Summary ===");
    console.log({
        pointsCount: points.length,
        targetVariationId: result?.meta?.targetVariationId || null,
        strengthPeakNormalized: result?.meta?.strengthPeakNormalized || null,
        strengthPeak: result?.meta?.strengthPeak || null,
        percentageFromStart: result?.meta?.strengthPeak?.percentageFromStart ?? null,
        firstSetPeak: result?.meta?.strengthPeak?.firstSetPeak ?? null,
        difficultyRatioDistribution: byRatio,
        pathLengthDistribution: byPathLength
    });
    console.log("=== Full Result ===");
    console.log(JSON.stringify(result, null, 2));
}

run()
    .catch((err) => {
        console.error("Test failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

