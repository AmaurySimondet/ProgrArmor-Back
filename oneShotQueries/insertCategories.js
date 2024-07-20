// Import required modules
const { MongoClient } = require('mongodb');
const AllCategories = require('./Categories/AllCategories');
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
async function createCategoriesToInsert(categories) {
    const categoriesToInsert = [];

    for (const categorie of categories.filter(categorie => categorie.label === categorie.value)) {
        const translatedName = await translateText(categorie.name, 'en');
        const translatedValue = await translateText(categorie.value, 'en');
        categoriesToInsert.push({
            createdAt: now,
            updatedAt: now,
            type: {
                fr: categorie.name,
                en: translatedName,
            },
            name: {
                fr: categorie.value,
                en: translatedValue,
            },
        });
    }

    return categoriesToInsert;
}

// Function to insert categories into the MongoDB collection
async function insertCategories() {
    // Create a new MongoClient
    const client = new MongoClient(url, { useUnifiedTopology: true });

    try {
        // Connect to the MongoDB server
        await client.connect();
        console.log("Connected successfully to MongoDB server");

        // Get the database and collection
        const db = client.db(dbName);
        const collection = db.collection('categorie');

        // Create the categories to insert
        const categoriesToInsert = await createCategoriesToInsert(AllCategories);

        // Insert the categories
        const result = await collection.insertMany(categoriesToInsert);
        console.log(`${result.insertedCount} documents were inserted`);
    } catch (err) {
        console.error("Error inserting documents:", err);
    } finally {
        // Close the connection
        await client.close();
    }
}

// Run the insertCategories function
insertCategories().catch(console.error);