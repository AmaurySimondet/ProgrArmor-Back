const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;

if (!uri) {
    throw new Error('Missing env var: mongoURL');
}

function getDbName() {
    if (process.env.DATABASE_NAME) return process.env.DATABASE_NAME;
    if (process.env.DATABASE) return process.env.DATABASE.split('/').pop().split('?')[0];
    throw new Error('Missing DATABASE_NAME or DATABASE in environment variables');
}

function parseVariationIds(argv) {
    if (!argv.length) {
        throw new Error(
            'Usage: node oneShotQueries/deleteVariationsIfUnused.js <variationId[,variationId2,...]> [variationId3 ...]'
        );
    }

    const ids = argv
        .flatMap((arg) => String(arg).split(','))
        .map((id) => id.trim())
        .filter(Boolean);

    if (!ids.length) {
        throw new Error('No variation id provided.');
    }

    const invalidIds = ids.filter((id) => !ObjectId.isValid(id));
    if (invalidIds.length) {
        throw new Error(`Invalid variation id(s): ${invalidIds.join(', ')}`);
    }

    return [...new Set(ids)];
}

async function assertNoSeanceSetReference(db, variationObjectIds, variationIdStrings) {
    const usages = await db.collection('seancesets').aggregate([
        { $match: { 'variations.variation': { $in: variationObjectIds } } },
        { $unwind: '$variations' },
        { $match: { 'variations.variation': { $in: variationObjectIds } } },
        {
            $group: {
                _id: '$variations.variation',
                usageCount: { $sum: 1 }
            }
        }
    ]).toArray();

    if (!usages.length) return;

    const usageMap = new Map(usages.map((row) => [String(row._id), Number(row.usageCount || 0)]));
    const blockingIds = variationIdStrings.filter((id) => usageMap.has(id));

    const details = blockingIds.map((id) => `${id} (used ${usageMap.get(id)} time(s))`).join(', ');
    throw new Error(
        `Suppression bloquee: certaines variations sont referencees dans seancesets. ${details}`
    );
}

async function deleteVariationsIfUnused(variationIds) {
    const client = new MongoClient(uri);
    const dbName = getDbName();
    const variationObjectIds = variationIds.map((id) => new ObjectId(id));

    try {
        await client.connect();
        const db = client.db(dbName);
        console.log(`Connected to database: ${dbName}`);
        console.log(`Requested variation ids (${variationIds.length}): ${variationIds.join(', ')}`);

        await assertNoSeanceSetReference(db, variationObjectIds, variationIds);

        const deleteResult = await db.collection('variations').deleteMany({
            _id: { $in: variationObjectIds }
        });

        console.log(`Matched variations: ${deleteResult.deletedCount}`);
        console.log('Done.');
    } finally {
        await client.close();
    }
}

async function run() {
    try {
        const variationIds = parseVariationIds(process.argv.slice(2));
        await deleteVariationsIfUnused(variationIds);
    } catch (error) {
        console.error('Error deleting variations:', error.message);
        process.exitCode = 1;
    }
}

run();
