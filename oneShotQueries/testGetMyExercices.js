const mongoose = require("mongoose");
const { MongoClient } = require('mongodb');
require("dotenv").config();
const set = require("../lib/set");

// Connect to MongoDB using mongoose for models
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// MongoDB client for direct operations
const uri = process.env.mongoURL;
const client = new MongoClient(uri);
const Variation = require("../schema/variation");

const searchPipeline = [
    {
        $search: {
            index: "default",
            compound: {
                should: [
                    {
                        autocomplete: {
                            query: "bench press",
                            path: "mergedVariationsNames.fr",
                            fuzzy: {
                                maxEdits: 2,
                                prefixLength: 0,
                                maxExpansions: 50,
                            },
                            score: { boost: { value: 1 } },
                        },
                    },
                    {
                        text: {
                            query: "bench press",
                            path: "mergedVariationsNames.fr",
                            score: { boost: { value: 3 } },
                        },
                    },
                    {
                        autocomplete: {
                            query: "bench press",
                            path: "mergedVariationsNames.en",
                            fuzzy: {
                                maxEdits: 2,
                                prefixLength: 0,
                                maxExpansions: 50,
                            },
                            score: { boost: { value: 1 } },
                        },
                    },
                    {
                        text: {
                            query: "bench press",
                            path: "mergedVariationsNames.en",
                            score: { boost: { value: 3 } },
                        },
                    },
                ],
                filter: [
                    {
                        equals: {
                            value: new mongoose.Types.ObjectId(
                                "6365489f44d4b4000470882b"
                            ),
                            path: "user",
                        },
                    },
                ],
                minimumShouldMatch: 1,
            },
        },
    },
]

async function testGetMyExercices() {
    try {
        await client.connect();
        const db = client.db("progarmor");
        console.log("Connected to database:", "progarmor");

        const { variations, total } = await set.getMyExercices("6365489f44d4b4000470882b", "squat", 1, 10);
        console.log("Response from variationsWithDocs:", variations);
        console.log("First document of variationsWithDocs:", variations[0]);
        console.log("Total:", total);

    } catch (error) {
        console.error('❌ Database connection error:', error);
    } finally {
        await client.close();
        await mongoose.connection.close();
        console.log('✅ Database connections closed');
    }
}

async function testGetMyExercicesAll() {
    try {
        await client.connect();
        const db = client.db("progarmor");
        console.log("Connected to database:", "progarmor");

        const { variations, total } = await set.getMyExercicesAll("6365489f44d4b4000470882b", 2, 10);
        console.log("Response from variationsWithDocs:", variations);
        console.log("First document of variationsWithDocs:", variations[0]);
        console.log("Total:", total);

    } catch (error) {
        console.error('❌ Database connection error:', error);
    } finally {
        await client.close();
        await mongoose.connection.close();
        console.log('✅ Database connections closed');
    }
}

// Execute the function
testGetMyExercicesAll();