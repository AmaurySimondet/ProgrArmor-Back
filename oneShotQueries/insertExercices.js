// Import required modules
const { MongoClient } = require('mongodb');
const Exercices = require('./data/Exercices');
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
async function createExercicesToInsert(exercices) {
    const exercicesToInsert = [];

    // filter when name is undefined
    for (const exercice of exercices.filter(exercice => exercice.name !== undefined)) {
        const translatedName = await translateText(exercice.name, 'en');
        const translatedValue = await translateText(exercice.value, 'en');
        exercicesToInsert.push({
            createdAt: now,
            updatedAt: now,
            type: {
                fr: exercice.name,
                en: translatedName,
            },
            name: {
                fr: exercice.value,
                en: translatedValue,
            },
        });
    }

    return exercicesToInsert;
}

// Function to insert exercices into the MongoDB collection
async function insertExercices() {
    // Create a new MongoClient
    const client = new MongoClient(url, { useUnifiedTopology: true });

    try {
        // Connect to the MongoDB server
        await client.connect();
        console.log("Connected successfully to MongoDB server");

        // Get the database and collection
        const db = client.db(dbName);
        const collection = db.collection('exercice');

        // Create the exercices to insert
        const exercicesToInsert = await createExercicesToInsert(Exercices);

        // Insert the exercices
        const result = await collection.insertMany(exercicesToInsert);
        console.log(`${result.insertedCount} documents were inserted`);
    } catch (err) {
        console.error("Error inserting documents:", err);
    } finally {
        // Close the connection
        await client.close();
    }
}

// Run the insertExercices function
insertExercices().catch(console.error);