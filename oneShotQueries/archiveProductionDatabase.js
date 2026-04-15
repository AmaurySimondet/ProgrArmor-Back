const { MongoClient } = require('mongodb');
require('dotenv').config();

function getArchiveSuffix(date = new Date()) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}UTC`;
}

async function archiveProductionDatabase() {
    let client;
    try {
        client = new MongoClient(process.env.mongoURL);
        await client.connect();

        const sourceDbName = process.env.ARCHIVE_SOURCE_DB || 'progarmor';
        const archivePrefix = process.env.ARCHIVE_DB_PREFIX || `${sourceDbName}-archive`;
        const targetDbName = `${archivePrefix}-${getArchiveSuffix()}`;

        const sourceDb = client.db(sourceDbName);
        const targetDb = client.db(targetDbName);

        console.log(`Archiving from ${sourceDbName} to ${targetDbName}`);

        const collections = await sourceDb.listCollections().toArray();

        for (const collection of collections) {
            const collectionName = collection.name;
            console.log(`Copying collection: ${collectionName}`);

            const documents = await sourceDb.collection(collectionName).find({}).toArray();

            if (documents.length > 0) {
                await targetDb.collection(collectionName).insertMany(documents);
                console.log(`Copied ${documents.length} documents from ${collectionName}`);
            } else {
                console.log(`Collection ${collectionName} is empty`);
            }
        }

        console.log(`Archive completed successfully in database: ${targetDbName}`);
    } catch (error) {
        console.error('Error archiving database:', error);
        process.exitCode = 1;
    } finally {
        if (client) {
            await client.close();
        }
        console.log('Database connections closed');
    }
}

archiveProductionDatabase().catch(console.error);
