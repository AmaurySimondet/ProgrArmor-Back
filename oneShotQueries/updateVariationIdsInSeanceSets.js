const mongoose = require("mongoose");
const { MongoClient } = require('mongodb');
require("dotenv").config();
const { Types } = require('mongoose')

// Connect to MongoDB using mongoose for models
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Import models
const Exercice = require("../schema/exercice");
const Categorie = require("../schema/categorie");
const Variation = require("../schema/variation");

// MongoDB client for direct operations
const uri = process.env.mongoURL;
const client = new MongoClient(uri);

// // The variation IDs that don't exist yet
// const variationIdsToUpdate = [
//     "67ab69b5f1a6eedfede28e15",
//     "67ab6a0ef1a6eedfede28e16",
//     "6810bdeb427fbf000388fdef",
//     "669ced7e665a3ffe77714365",
//     "669ced7e665a3ffe77714362",
//     "669ced7e665a3ffe77714361",
//     "67a7739953b06f1c809554b8",
//     "669ced7e665a3ffe77714366",
//     "669ced7e665a3ffe77714363",
//     "67802555d43d5d2d161ed942",
//     "669ced7e665a3ffe77714364",
//     "678022e21368152aa63ae286",
//     "677fecaf6294b680edf9765b",
// ];

async function updateVariationIdsInSeanceSets() {
    try {
        await client.connect();
        const db = client.db("progarmor");
        console.log("Connected to database: ", "progarmor");

        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;

        const result = await db.collection('seancesets').aggregate([
            // 1. Unwind variations
            { $unwind: "$variations" },

            // 2. Lookup variation document
            {
                $lookup: {
                    from: "variations",
                    localField: "variations.variation",
                    foreignField: "_id",
                    as: "variation_doc"
                }
            },

            // 3. Keep only when no match is found AND variation is not null
            {
                $match: {
                    variation_doc: { $size: 0 },
                    "variations.variation": { $ne: null }
                }
            },

            // 4. Project only the variation id
            {
                $project: {
                    _id: 0,
                    variationId: "$variations.variation"
                }
            },

            // 5. Group and deduplicate ids
            {
                $group: {
                    _id: null,
                    missingVariationIds: { $addToSet: "$variationId" }
                }
            }
        ]).toArray();

        const variationIdsToUpdate = result[0]?.missingVariationIds || [];

        console.log(`Found ${variationIdsToUpdate.length} missing variation IDs`);

        const manualMapping = {
            "669c3609218324e0b7682b5a": "66cc8e26148b9943caa05ce7",  // Puissance/Power → Explosif/Power
            "67a7739953b06f1c809554b8": "669c3609218324e0b7682a57",  // Pupitre → Sur pupitre/Preacher
            "677fecaf6294b680edf9765b": "691b33ba9c28bf0f3ee12357",  // Frontal → Frontale/Front
            "6810bdeb427fbf000388fdef": "6922144d1c858345acc2d135",  // Hyper extension → Extensions lombaires/Back Extension
            "678022e21368152aa63ae286": "669c3609218324e0b7682a66",  // 2 doigts: D-po-in → Sur les doigts/On fingers
        };

        for (const originalId of variationIdsToUpdate) {
            try {
                processedCount++;
                console.log(`\n[${processedCount}/${variationIdsToUpdate.length}] 🔄 Processing ID: ${originalId}`);

                // 1. Find the original document in exercices or categories
                let originalDoc = await Exercice.findById(originalId);
                let docType = 'exercice';

                if (!originalDoc) {
                    originalDoc = await Categorie.findById(originalId);
                    docType = 'categorie';
                }

                if (!originalDoc) {
                    console.log(`  ❌ Document not found in exercices or categories: ${originalId}`);
                    errorCount++;
                    continue;
                }

                console.log(`  ✅ Found ${docType}: ${originalDoc.name.fr} / ${originalDoc.name.en}`);

                // 2. Find the variation: check manual mapping first, then "doigt" pattern, then name match
                let variation = null;

                if (manualMapping[originalId.toString()]) {
                    variation = await Variation.findById(manualMapping[originalId.toString()]);
                    if (variation) console.log(`  📌 Using manual mapping`);
                }

                if (!variation && (originalDoc.name.fr?.toLowerCase().includes("doigt") || originalDoc.name.en?.toLowerCase().includes("doigt"))) {
                    variation = await Variation.findById("669c3609218324e0b7682a66");
                    if (variation) console.log(`  📌 Matched "doigt" pattern → Sur les doigts/On fingers`);
                }

                if (!variation) {
                    variation = await Variation.findOne({
                        $or: [
                            { "name.fr": originalDoc.name.fr },
                            { "name.en": originalDoc.name.en }
                        ]
                    });
                }

                if (!variation) {
                    console.log(`  ❌❌❌ Variation not found for: ${originalDoc.name.fr} / ${originalDoc.name.en}`);
                    errorCount++;
                    continue;
                }

                console.log(`  ✅ Found variation: ${variation.name.fr} / ${variation.name.en} (ID: ${variation._id})`);

                // 3. Update all seancesets where variations.variation is the original ID
                console.log(`   Updating seancesets with variation ID: ${originalId}`);
                console.log(`   Updating seancesets with variation ID: ${variation._id}`);
                const result = await db.collection('seancesets').updateMany(
                    { "variations.variation": new Types.ObjectId(originalId) },
                    { $set: { "variations.$.variation": variation._id } }
                );

                if (result.modifiedCount > 0) {
                    console.log(`  ✅ Updated ${result.modifiedCount} seancesets`);
                    successCount++;
                } else {
                    console.log(`  ⚠️  No seancesets found with this variation ID`);
                }

            } catch (error) {
                console.error(`  ❌ Error processing ${originalId}:`, error.message);
                errorCount++;
            }
        }

        console.log(`\n📊 Summary:`);
        console.log(`  Total processed: ${processedCount}`);
        console.log(`  Success: ${successCount}`);
        console.log(`  Errors: ${errorCount}`);

    } catch (error) {
        console.error('❌ Database connection error:', error);
    } finally {
        await client.close();
        await mongoose.connection.close();
        console.log('✅ Database connections closed');
    }
}

// Execute the function
updateVariationIdsInSeanceSets();
