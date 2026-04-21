/**
 * Usage:
 *   node oneShotQueries/testWhichFigure.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const whichfigure = require("../lib/whichfigure");
const Set = require("../schema/seanceset");

const USER_ID = "6365489f44d4b4000470882b";
const REFERENCE_VARIATION_ID = "669c3609218324e0b7682b2b"; // tuck

async function findMainExerciseIdForVariation(userId, variationId) {
    const row = await Set.findOne(
        {
            user: new mongoose.Types.ObjectId(userId),
            "variations.variation": new mongoose.Types.ObjectId(variationId)
        },
        { exercice: 1 }
    ).lean();
    return row?.exercice ? String(row.exercice) : null;
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    const mainExerciseId = await findMainExerciseIdForVariation(USER_ID, REFERENCE_VARIATION_ID);
    if (!mainExerciseId) {
        throw new Error("Unable to resolve mainExerciseId from reference variation.");
    }

    const commonInput = {
        userId: USER_ID,
        mainExerciseId,
        referenceVariations: REFERENCE_VARIATION_ID,
        maxTargets: 25,
        includeAllGraphTargets: true,
        expandGenericTargets: true
    };

    const weightFullScope = await whichfigure.computeRecommendedWeightFigure({
        ...commonInput,
        targetUnit: "repetitions",
        targetValue: 10
    });
    console.log("whichweight-figure full-scope -> targets:", weightFullScope?.recommendations?.length);
    console.log("whichweight-figure sample:", weightFullScope?.recommendations?.slice(0, 3));

    const weightRestricted = await whichfigure.computeRecommendedWeightFigure({
        ...commonInput,
        targetUnit: "repetitions",
        targetValue: 10,
        includeAllGraphTargets: false,
        expandGenericTargets: false
    });
    console.log("whichweight-figure restricted -> targets:", weightRestricted?.recommendations?.length);

    const valueAtZeroKg = await whichfigure.computeRecommendedValueFigure({
        ...commonInput,
        targetUnit: "repetitions",
        effectiveWeightLoad: 0
    });
    console.log("whichvalue-figure @0kg sample:", valueAtZeroKg?.recommendations?.slice(0, 3));

    const valueAtNegativeLoad = await whichfigure.computeRecommendedValueFigure({
        ...commonInput,
        targetUnit: "repetitions",
        effectiveWeightLoad: -40
    });
    console.log("whichvalue-figure @-40kg sample:", valueAtNegativeLoad?.recommendations?.slice(0, 3));
}

run()
    .catch((err) => {
        console.error("Test failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

