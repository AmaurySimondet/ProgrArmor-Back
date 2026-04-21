/**
 * Usage:
 *   node oneShotQueries/backfillVariationTypesDragonLSitVSit.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");
const SeanceSet = require("../schema/seanceset");

const TARGET_TYPE_ID = "669cee980c89e9434327caa8";
const VARIATION_IDS = [
    "669ced7e665a3ffe7771437e", // dragon flag
    "669ced7e665a3ffe7771438a", // l sit
    "669ced7e665a3ffe7771438b", // v sit
];
const POSSIBLE_PROGRESSION_FALSE_IDS = [
    "669ced7e665a3ffe7771438a", // l sit
    "669ced7e665a3ffe7771438b", // v sit
];

function toObjectId(id) {
    return new mongoose.Types.ObjectId(id);
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    const targetTypeObjectId = toObjectId(TARGET_TYPE_ID);
    const variationObjectIds = VARIATION_IDS.map(toObjectId);
    const noProgressionObjectIds = POSSIBLE_PROGRESSION_FALSE_IDS.map(toObjectId);

    // 1) Backfill type on Variation documents
    const variationUpdateResult = await Variation.updateMany(
        { _id: { $in: variationObjectIds } },
        { $set: { type: targetTypeObjectId } }
    );
    const progressionUpdateResult = await Variation.updateMany(
        { _id: { $in: noProgressionObjectIds } },
        { $set: { possibleProgression: false } }
    );

    // 2) Backfill type on embedded SeanceSet variations
    let seanceSetMatched = 0;
    let seanceSetModified = 0;
    for (const variationId of variationObjectIds) {
        const result = await SeanceSet.updateMany(
            { "variations.variation": variationId },
            { $set: { "variations.$[elem].type": targetTypeObjectId } },
            { arrayFilters: [{ "elem.variation": variationId }] }
        );
        seanceSetMatched += result.matchedCount || 0;
        seanceSetModified += result.modifiedCount || 0;
    }

    console.log("Backfill terminé.");
    console.log("Variation.updateMany");
    console.log(`- matchedCount: ${variationUpdateResult.matchedCount || 0}`);
    console.log(`- modifiedCount: ${variationUpdateResult.modifiedCount || 0}`);
    console.log("Variation.updateMany (possibleProgression=false)");
    console.log(`- matchedCount: ${progressionUpdateResult.matchedCount || 0}`);
    console.log(`- modifiedCount: ${progressionUpdateResult.modifiedCount || 0}`);
    console.log("SeanceSet.updateMany (cumulé)");
    console.log(`- matchedCount: ${seanceSetMatched}`);
    console.log(`- modifiedCount: ${seanceSetModified}`);
}

run()
    .catch((err) => {
        console.error("Backfill failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

