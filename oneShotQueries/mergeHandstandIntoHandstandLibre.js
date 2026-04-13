/**
 * Fusionne la variation « handstand » (669ced7e665a3ffe77714386)
 * vers « handstand libre » (692214541c858345acc2d405).
 *
 * Usage: node oneShotQueries/mergeHandstandIntoHandstandLibre.js
 */
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const SOURCE_VARIATION_ID = "669ced7e665a3ffe77714386";
const TARGET_VARIATION_ID = "692214541c858345acc2d405";

const uri = process.env.mongoURL;
const databaseName = process.env.DATABASE?.replace(/^\//, "");

if (!uri) {
    throw new Error("Missing env var: mongoURL");
}

if (!databaseName) {
    throw new Error("Missing env var: DATABASE");
}

async function run() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(databaseName);
        const seanceSetsCollection = db.collection("seancesets");
        const variationsCollection = db.collection("variations");

        const sourceObjectId = new ObjectId(SOURCE_VARIATION_ID);
        const targetObjectId = new ObjectId(TARGET_VARIATION_ID);

        const seanceCount = await seanceSetsCollection.countDocuments({
            "variations.variation": sourceObjectId,
        });
        console.log(`seancesets avec ${SOURCE_VARIATION_ID}: ${seanceCount}`);

        const seanceUpdate = await seanceSetsCollection.updateMany(
            { "variations.variation": sourceObjectId },
            { $set: { "variations.$[variationItem].variation": targetObjectId } },
            {
                arrayFilters: [{ "variationItem.variation": sourceObjectId }],
            }
        );
        console.log(`seancesets matched: ${seanceUpdate.matchedCount}, modified: ${seanceUpdate.modifiedCount}`);

        const freeHandstandEq = await variationsCollection.updateOne(
            { _id: targetObjectId },
            { $set: { equivalentTo: [] } }
        );
        console.log(`handstand libre equivalentTo vide: matched ${freeHandstandEq.matchedCount}, modified ${freeHandstandEq.modifiedCount}`);

        const pullEq = await variationsCollection.updateMany(
            { equivalentTo: sourceObjectId },
            { $pull: { equivalentTo: sourceObjectId } }
        );
        console.log(`$pull equivalentTo sur autres variations: matched ${pullEq.matchedCount}, modified ${pullEq.modifiedCount}`);

        const del = await variationsCollection.deleteOne({ _id: sourceObjectId });
        console.log(`suppression variation handstand: deletedCount ${del.deletedCount}`);

        const remainingSeance = await seanceSetsCollection.countDocuments({
            "variations.variation": sourceObjectId,
        });
        console.log(`seancesets restants avec ancien id: ${remainingSeance}`);
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

run();
