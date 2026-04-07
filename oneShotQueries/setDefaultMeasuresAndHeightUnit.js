const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
const client = new MongoClient(uri);

function getDatabaseName() {
    if (!process.env.DATABASE) {
        throw new Error('Missing DATABASE env var');
    }

    return process.env.DATABASE.split('/').filter(Boolean).pop();
}

async function setDefaultMeasuresAndHeightUnit() {
    try {
        await client.connect();
        const dbName = getDatabaseName();
        const db = client.db(dbName);

        console.log(`Connected to database: ${dbName}`);

        const usersCollection = db.collection('users');
        const measuresCollection = db.collection('usermeasures');

        // 1) Force heightUnit=cm for every user.
        const userUpdateResult = await usersCollection.updateMany(
            {},
            { $set: { heightUnit: 'cm' } }
        );

        // 2) Reset user measures and recreate defaults in the new mandatory format.
        const users = await usersCollection.find({}, { projection: { _id: 1 } }).toArray();
        const now = new Date();
        const deleteResult = await measuresCollection.deleteMany({});

        const defaultMeasures = users.map((user) => ({
            userId: user._id,
            measuredAt: now,
            height: { cm: 170, ft: 5.5774 },
            weight: { kg: 70, lb: 154.32 },
            createdAt: now,
            updatedAt: now
        }));

        let insertedCount = 0;
        if (defaultMeasures.length > 0) {
            const insertResult = await measuresCollection.insertMany(defaultMeasures);
            insertedCount = insertResult.insertedCount || 0;
        }

        console.log('--- One-shot summary ---');
        console.log(`Users updated (heightUnit=cm): ${userUpdateResult.modifiedCount}`);
        console.log(`User measures deleted: ${deleteResult.deletedCount}`);
        console.log(`Default measures inserted: ${insertedCount}`);
        console.log('Done.');
    } catch (error) {
        console.error('Error in setDefaultMeasuresAndHeightUnit:', error);
    } finally {
        await client.close();
    }
}

setDefaultMeasuresAndHeightUnit();
