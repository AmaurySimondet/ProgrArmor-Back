const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
const client = new MongoClient(uri);

async function mergeUser(fromUserId, toUserId) {
    try {
        await client.connect();
        const db = client.db(process.env.DATABASE.split('/')[1]);
        console.log("Connected to database: ", process.env.DATABASE.split('/')[1]);

        // Convert string IDs to ObjectId
        const fromUserObjId = new ObjectId(fromUserId);
        const toUserObjId = new ObjectId(toUserId);

        // Update followers and following arrays in users collection
        await db.collection('users').updateMany(
            { followers: fromUserObjId },
            { $set: { "followers.$": toUserObjId } }
        );

        await db.collection('users').updateMany(
            { following: fromUserObjId },
            { $set: { "following.$": toUserObjId } }
        );

        // Get the old user's followers and following
        const oldUser = await db.collection('users').findOne({ _id: fromUserObjId });
        if (!oldUser) {
            throw new Error('Source user not found');
        }

        // Merge followers and following arrays into the target user
        await db.collection('users').updateOne(
            { _id: toUserObjId },
            {
                $addToSet: {
                    followers: { $each: oldUser.followers || [] },
                    following: { $each: oldUser.following || [] }
                }
            }
        );

        // Get all collections except 'users'
        const collections = await db.listCollections().toArray();
        const filteredCollections = collections.filter(coll => coll.name !== 'users');

        // Update references in all other collections
        for (const collection of filteredCollections) {
            const collName = collection.name;
            const result = await db.collection(collName).updateMany(
                { user: fromUserObjId },
                { $set: { user: toUserObjId } }
            );

            console.log(`Updated ${result.modifiedCount} documents in ${collName}`);
        }

        // Delete original user
        const deleteResult = await db.collection('users').deleteOne({ _id: fromUserObjId });
        console.log(`Deleted user: ${deleteResult.deletedCount} document`);

        console.log('User merge completed successfully');
    } catch (error) {
        console.error('Error merging users:', error);
    } finally {
        await client.close();
    }
}

// Example usage (pass actual ObjectId strings):
// mergeUser('OLD_USER_ID', 'NEW_USER_ID');
mergeUser('6783b3fdc8059a0003ef9397', '67af4613b20cf00003a492c6');