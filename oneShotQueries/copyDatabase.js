const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function copyDatabase() {
    try {
        // Create MongoDB client
        const client = new MongoClient(process.env.mongoURL);
        await client.connect();

        const dropTarget = true;
        const sourceDbName = 'progarmor';
        const targetDbName = 'progarmor-test';

        const sourceDb = client.db(sourceDbName);
        const targetDb = client.db(targetDbName);

        if (dropTarget) {
            await targetDb.dropDatabase();
        }

        console.log('Connected to MongoDB');
        console.log(`Copying from ${sourceDbName} to ${targetDbName}`);

        // Get list of collections from source database
        const collections = await sourceDb.listCollections().toArray();

        // Copy each collection
        for (const collection of collections) {
            const collectionName = collection.name;
            console.log(`Copying collection: ${collectionName}`);

            // Get all documents from source collection
            const documents = await sourceDb.collection(collectionName).find({}).toArray();

            if (documents.length > 0) {
                // Insert documents into target collection
                await targetDb.collection(collectionName).insertMany(documents);
                console.log(`Copied ${documents.length} documents from ${collectionName}`);
            } else {
                console.log(`Collection ${collectionName} is empty`);
            }
        }

        console.log('Database copy completed successfully');
    } catch (error) {
        console.error('Error copying database:', error);
    } finally {
        // Close MongoDB connections
        await mongoose.connection.close();
        console.log('Database connections closed');
    }
}

// Execute the copy
copyDatabase().catch(console.error); 