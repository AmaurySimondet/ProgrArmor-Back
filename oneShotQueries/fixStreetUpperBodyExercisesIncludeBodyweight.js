const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
if (!uri) {
    throw new Error('Missing env var: mongoURL');
}

const STREET_UPPER_BODY_TYPE_ID = '669cee980c89e9434327caa7';
const DEFAULT_BWR = 0.85;

function getDbName() {
    if (process.env.DATABASE_NAME) return process.env.DATABASE_NAME;
    if (process.env.DATABASE) return process.env.DATABASE.split('/').pop().split('?')[0];
    throw new Error('Missing DATABASE_NAME or DATABASE in environment variables');
}

function buildUpdatePayload(doc) {
    const set = {
        weightType: 'bodyweight_plus_external',
        includeBodyweight: true
    };

    if (typeof doc.exerciseBodyWeightRatio !== 'number') {
        set.exerciseBodyWeightRatio = DEFAULT_BWR;
    }

    return set;
}

async function run() {
    const apply = process.argv.includes('--apply');
    const client = new MongoClient(uri);
    const dbName = getDbName();

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('variations');
        const typeObjectId = new ObjectId(STREET_UPPER_BODY_TYPE_ID);

        const docs = await collection.find({
            type: typeObjectId,
            isExercice: true,
            includeBodyweight: false
        }).project({
            _id: 1,
            name: 1,
            muscles: 1,
            weightType: 1,
            includeBodyweight: 1,
            exerciseBodyWeightRatio: 1
        }).toArray();

        console.log(`Database: ${dbName}`);
        console.log(`Street upper-body exercises with includeBodyweight=false: ${docs.length}`);

        let plannedUpdates = 0;
        for (const doc of docs) {
            const set = buildUpdatePayload(doc);
            const needsUpdate =
                doc.weightType !== 'bodyweight_plus_external' ||
                doc.includeBodyweight !== true ||
                typeof doc.exerciseBodyWeightRatio !== 'number';

            if (!needsUpdate) {
                console.log(`- SKIP ${doc._id} | ${doc?.name?.fr || doc?.name?.en || 'Unnamed'}`);
                continue;
            }

            plannedUpdates += 1;
            console.log(`- PLAN ${doc._id} | ${doc?.name?.fr || doc?.name?.en || 'Unnamed'}`);
            console.log(`  set: ${JSON.stringify(set)}`);

            if (apply) {
                await collection.updateOne({ _id: doc._id }, { $set: set });
            }
        }

        console.log(`Planned updates: ${plannedUpdates}`);
        if (!apply) {
            console.log('Dry-run mode. Re-run with --apply to persist changes.');
        } else {
            console.log('Updates applied.');
        }
    } finally {
        await client.close();
    }
}

run().catch((error) => {
    console.error('fixStreetUpperBodyExercisesIncludeBodyweight failed:', error.message);
    process.exitCode = 1;
});
