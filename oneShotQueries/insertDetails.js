// Import required modules
const { MongoClient } = require('mongodb');
const AllDetails = require('./Details/AllDetails');
const translate = require('@vitalets/google-translate-api').translate;
require('dotenv').config();

// MongoDB connection URL and database name
const url = process.env.mongoURL;
const dbName = 'prograrmor'; // replace with your database name if different

// Get the current timestamp
const now = new Date();

// Function to translate text
async function translateText(text, to) {
    try {
        const result = await translate(text, { to });
        return result.text;
    } catch (error) {
        console.error('Translation error:', error);
        return text; // Return the original text if translation fails
    }
}

// Function to create the list of objects to insert
async function createDetailsToInsert(details) {
    const detailsToInsert = [];

    for (const detail of details.filter(detail => detail.label === detail.value)) {
        const translatedName = await translateText(detail.name, 'en');
        const translatedValue = await translateText(detail.value, 'en');
        detailsToInsert.push({
            createdAt: now,
            updatedAt: now,
            type: {
                fr: detail.name,
                en: translatedName,
            },
            name: {
                fr: detail.value,
                en: translatedValue,
            },
        });
    }

    return detailsToInsert;
}

// Function to insert details into the MongoDB collection
async function insertDetails() {
    // Create a new MongoClient
    const client = new MongoClient(url, { useUnifiedTopology: true });

    try {
        // Connect to the MongoDB server
        await client.connect();
        console.log("Connected successfully to MongoDB server");

        // Get the database and collection
        const db = client.db(dbName);
        const collection = db.collection('detail');

        // Create the details to insert
        const detailsToInsert = await createDetailsToInsert(AllDetails);

        // Insert the details
        const result = await collection.insertMany(detailsToInsert);
        console.log(`${result.insertedCount} documents were inserted`);
    } catch (err) {
        console.error("Error inserting documents:", err);
    } finally {
        // Close the connection
        await client.close();
    }
}

// Run the insertDetails function
insertDetails().catch(console.error);