const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const SOURCE_VARIATION_ID = "669ced7e665a3ffe777143a1";
const TARGET_VARIATION_ID = "669ced7e665a3ffe77714385";

const uri = process.env.mongoURL;
const databaseName = process.env.DATABASE?.replace(/^\//, "");

if (!uri) {
    throw new Error("Missing env var: mongoURL");
}

if (!databaseName) {
    throw new Error("Missing env var: DATABASE");
}

async function replaceVariationIdInSeanceSets() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(databaseName);
        const seanceSetsCollection = db.collection("seancesets");

        const sourceObjectId = new ObjectId(SOURCE_VARIATION_ID);
        const targetObjectId = new ObjectId(TARGET_VARIATION_ID);

        const documentsToUpdateCount = await seanceSetsCollection.countDocuments({
            "variations.variation": sourceObjectId,
        });

        console.log(
            `Documents with variation ${SOURCE_VARIATION_ID}: ${documentsToUpdateCount}`
        );

        const updateResult = await seanceSetsCollection.updateMany(
            { "variations.variation": sourceObjectId },
            { $set: { "variations.$[variationItem].variation": targetObjectId } },
            {
                arrayFilters: [{ "variationItem.variation": sourceObjectId }],
            }
        );

        console.log(`Matched documents: ${updateResult.matchedCount}`);
        console.log(`Modified documents: ${updateResult.modifiedCount}`);

        const remainingDocumentsCount = await seanceSetsCollection.countDocuments({
            "variations.variation": sourceObjectId,
        });

        console.log(
            `Remaining documents with old variation ${SOURCE_VARIATION_ID}: ${remainingDocumentsCount}`
        );
        console.log("Done.");
    } catch (error) {
        console.error("Error while replacing variation ID in seancesets:", error);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

replaceVariationIdInSeanceSets();
