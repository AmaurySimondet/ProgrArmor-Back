const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
const client = new MongoClient(uri);

async function transformUser(user) {
    try {
        const newDb = client.db('prograrmor');
        const newUsersCollection = newDb.collection('users');

        // Prepare the new user object with updated field names
        const newUser = {
            _id: user._id,
            fName: user.fName,
            lName: user.lName,
            email: user.email,
            salt: user.salt,
            hash: user.hash,
            createdAt: user.created_at,
            updatedAt: user.updatedAt,
        };

        // Insert the transformed user into the new database
        await newUsersCollection.updateOne(
            { _id: newUser._id },
            { $set: newUser },
            { upsert: true }
        );

        console.log(`User ${user._id} transformed successfully.`);
    } catch (error) {
        console.error('Error transforming user:', error);
    }
}

async function convertUsers() {
    try {
        await client.connect();
        const oldDb = client.db('prograrmortestDB');
        const usersCollection = oldDb.collection('users');

        // Fetch all users from the old database
        const users = await usersCollection.find({}).toArray();

        // Process each user
        for (const user of users) {
            await transformUser(user);
        }
        console.log('All users have been transformed successfully.');
    } catch (error) {
        console.error('Error converting users:', error);
    } finally {
        await client.close();
    }
}

convertUsers();
