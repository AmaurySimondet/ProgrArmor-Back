/**
 * Usage:
 *   node oneShotQueries/testVariationProgressionTimeseriesCall.js
 *   node oneShotQueries/testVariationProgressionTimeseriesCall.js <userId> <mainExerciseId> [referenceVariationId]
 */
const mongoose = require("mongoose");
require("dotenv").config();

const setLib = require("../lib/set");

const DEFAULT_USER_ID = "6365489f44d4b4000470882b";
const DEFAULT_MAIN_EXERCISE_ID = "669ced7e665a3ffe7771437e";
const DEFAULT_REFERENCE_VARIATION_ID = "669c3609218324e0b7682b2b"; // tuck

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }

    const userId = process.argv[2] || DEFAULT_USER_ID;
    const mainExerciseId = process.argv[3] || DEFAULT_MAIN_EXERCISE_ID;
    const referenceVariationId = process.argv[4] || DEFAULT_REFERENCE_VARIATION_ID;

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    const result = await setLib.getNormalizedProgressionTimeseries({
        userId,
        mainExerciseId,
        referenceVariations: referenceVariationId,
        dateMin: null,
        dateMax: null,
        unit: null,
        unilateralSide: undefined,
        isUnilateral: undefined
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

