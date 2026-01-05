const mongoose = require("mongoose");
const { MongoClient } = require('mongodb');
require("dotenv").config();
const { Types } = require('mongoose');

// Connect to MongoDB using mongoose for models
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// MongoDB client for direct operations
const uri = process.env.mongoURL;
const client = new MongoClient(uri);

async function addVariationNamesInSeanceSets() {
    try {
        await client.connect();
        const db = client.db("progarmor");
        console.log("Connected to database:", "progarmor");

        // 1) Load all variations once and create a map variationId -> name
        const variations = await db.collection('variations')
            .find({}, { projection: { name: 1 } })
            .toArray();

        const variationNameById = new Map(
            variations.map(v => [v._id.toString(), v.name])
        );

        console.log(`Loaded ${variations.length} variations`);

        // 2) Stream through all seancesets and prepare bulk updates
        const cursor = db.collection('seancesets').find({}, { projection: { variations: 1 } });

        const bulkOps = [];
        let processed = 0;

        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            processed += 1;

            if (!Array.isArray(doc.variations) || doc.variations.length === 0) {
                continue;
            }

            const newVariations = doc.variations.map(v => {
                if (!v.variation) return v;

                const idStr = v.variation.toString();
                const name = variationNameById.get(idStr);

                if (!name) return v;

                return {
                    ...v,
                    name,
                };
            });

            const mergedVariationsNames = {
                fr: newVariations?.length > 0 ? newVariations.map(v => v.name?.fr).join(', ') : null,
                en: newVariations?.length > 0 ? newVariations.map(v => v.name?.en).join(', ') : null,
            };

            bulkOps.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: { variations: newVariations, mergedVariationsNames: mergedVariationsNames } },
                },
            });

            // Execute in batches to avoid huge bulk operations
            if (bulkOps.length >= 1000) {
                const res = await db.collection('seancesets').bulkWrite(bulkOps);
                console.log(`Batch updated ${res.modifiedCount} documents`);
                bulkOps.length = 0;
            }
        }

        // Flush remaining operations
        if (bulkOps.length > 0) {
            const res = await db.collection('seancesets').bulkWrite(bulkOps);
            console.log(`Final batch updated ${res.modifiedCount} documents`);
        }

        console.log(`Processed ${processed} seancesets documents`);
        console.log('Seancesets update completed successfully (without $lookup in update)');
    } catch (error) {
        console.error('❌ Database connection error:', error);
    } finally {
        await client.close();
        await mongoose.connection.close();
        console.log('✅ Database connections closed');
    }
}

// Execute the function
addVariationNamesInSeanceSets();
