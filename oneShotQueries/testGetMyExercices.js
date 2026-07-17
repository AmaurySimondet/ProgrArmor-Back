const mongoose = require("mongoose");
const { MongoClient } = require('mongodb');
require("dotenv").config();
const set = require("../lib/set");
const { buildMyExercisesSearchCompound } = require("../lib/variationSearchPipelines");

// Connect to MongoDB using mongoose for models
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// MongoDB client for direct operations
const uri = process.env.mongoURL;
const client = new MongoClient(uri);

const USER_ID = "6365489f44d4b4000470882b";
const SEARCH_QUERY = "bench press";

const searchPipeline = [
    {
        $search: {
            index: "default",
            compound: buildMyExercisesSearchCompound({
                search: SEARCH_QUERY,
                userId: new mongoose.Types.ObjectId(USER_ID),
            }),
        },
    },
];

async function testGetMyExercices() {
    try {
        await client.connect();
        const db = client.db("progarmor");
        console.log("Connected to database:", "progarmor");

        const { variations, total } = await set.getMyExercices(USER_ID, "squat", 1, 10);
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

        const { variations, total } = await set.getMyExercicesAll(USER_ID, 2, 10);
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