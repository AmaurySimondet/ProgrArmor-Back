const { MongoClient, ObjectId } = require('mongodb');
const readline = require('readline');
require('dotenv').config();

const uri = process.env.mongoURL;
const client = new MongoClient(uri);

function getDbName() {
    if (process.env.DATABASE_NAME) {
        return process.env.DATABASE_NAME;
    }

    if (process.env.DATABASE) {
        return process.env.DATABASE.split('/').pop().split('?')[0];
    }

    throw new Error('Missing DATABASE_NAME or DATABASE in environment variables');
}

function askConfirmation(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function deleteUserAndRelated(userId, force = false) {
    if (!ObjectId.isValid(userId)) {
        throw new Error(`Invalid user id: ${userId}`);
    }

    const userObjId = new ObjectId(userId);
    const dbName = getDbName();
    const db = client.db(dbName);

    const user = await db.collection('users').findOne({ _id: userObjId });
    if (!user) {
        throw new Error(`User not found: ${userId}`);
    }

    const [seancesCount, setsCount] = await Promise.all([
        db.collection('seances').countDocuments({ user: userObjId }),
        db.collection('seancesets').countDocuments({ user: userObjId })
    ]);

    console.log('--- User preview ---');
    console.log(`id      : ${user._id}`);
    console.log(`fName   : ${user.fName || ''}`);
    console.log(`lName   : ${user.lName || ''}`);
    console.log(`email   : ${user.email || ''}`);
    console.log(`seances : ${seancesCount}`);
    console.log(`sets    : ${setsCount}`);
    console.log('--------------------');

    if (!force) {
        const answer = await askConfirmation(
            `Are you sure you want to delete ${user.fName || ''} ${user.lName || ''} ${user.email || ''} with ${seancesCount} seances and ${setsCount} sets? Type "DELETE" to confirm: `
        );

        if (answer !== 'DELETE') {
            console.log('Deletion cancelled.');
            return;
        }
    }

    const allCollections = await db.listCollections().toArray();
    const filteredCollections = allCollections.filter((coll) => coll.name !== 'users');

    const deletedByCollection = {};

    // Delete any documents where { user: userId } in all non-users collections.
    for (const collection of filteredCollections) {
        const collName = collection.name;
        const result = await db.collection(collName).deleteMany({ user: userObjId });
        if (result.deletedCount > 0) {
            deletedByCollection[collName] = result.deletedCount;
        }
    }

    // Notifications reference users via fromUser/forUser (not user).
    const notificationDeleteResult = await db.collection('notifications').deleteMany({
        $or: [{ fromUser: userObjId }, { forUser: userObjId }]
    });
    if (notificationDeleteResult.deletedCount > 0) {
        deletedByCollection.notifications = (deletedByCollection.notifications || 0) + notificationDeleteResult.deletedCount;
    }

    // Seance comments can reference users in identifiedUsers.
    const seanceCommentPullResult = await db.collection('seancecomments').updateMany(
        { identifiedUsers: userObjId },
        { $pull: { identifiedUsers: userObjId } }
    );

    // Remove deleted user from followers/following arrays of other users.
    const followersUpdateResult = await db.collection('users').updateMany(
        { followers: userObjId },
        { $pull: { followers: userObjId } }
    );
    const followingUpdateResult = await db.collection('users').updateMany(
        { following: userObjId },
        { $pull: { following: userObjId } }
    );

    const userDeleteResult = await db.collection('users').deleteOne({ _id: userObjId });

    console.log('--- Deletion report ---');
    Object.entries(deletedByCollection).forEach(([collectionName, count]) => {
        console.log(`${collectionName}: deleted ${count}`);
    });
    console.log(`users: deleted ${userDeleteResult.deletedCount}`);
    console.log(`users/followers pull modified: ${followersUpdateResult.modifiedCount}`);
    console.log(`users/following pull modified: ${followingUpdateResult.modifiedCount}`);
    console.log(`seancecomments/identifiedUsers pull modified: ${seanceCommentPullResult.modifiedCount}`);
    console.log('Done.');
}

async function run() {
    const userId = process.argv[2];
    const force = process.argv.includes('--force');

    if (!userId) {
        console.error('Usage: node oneShotQueries/deleteUserAndRelated.js <USER_ID> [--force]');
        process.exit(1);
    }

    try {
        await client.connect();
        console.log(`Connected to database: ${getDbName()}`);
        await deleteUserAndRelated(userId, force);
    } catch (error) {
        console.error('Error deleting user and related data:', error);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

run();
