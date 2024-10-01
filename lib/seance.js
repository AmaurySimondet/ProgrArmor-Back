const mongoose = require('mongoose');
const Seance = require('../schema/seance'); // Adjust the path as needed
require('dotenv').config();

/**
 * Fetches the last seance of a user based on the seance date or createdAt with optional seance name filtering.
 * @param {string} userId - The ID of the user.
 * @param {string} field - The field to sort by ('date' or 'createdAt').
 * @param {string} [seanceName] - Optional seance name to filter.
 * @returns {Promise<Object>} - A promise that resolves to the last seance object.
 */
async function getLastSeance(userId, field, seanceName) {
    try {
        const query = { user: mongoose.Types.ObjectId(userId) };
        if (seanceName) {
            query.name = seanceName;
        }
        if (!field) {
            field = 'date';
        }

        const lastSeance = await Seance.findOne(query)
            .sort({ [field]: -1 })
            .exec();

        return lastSeance;
    } catch (err) {
        console.error("Error fetching last seance:", err);
        throw err;
    }
}

/**
 * Fetches all unique seance names for a user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<Array<string>>} - A promise that resolves to an array of unique seance names.
 */
async function getSeanceNames(userId) {
    try {
        const seances = await Seance.find({ user: mongoose.Types.ObjectId(userId) }, ["name", "date"]).sort({ date: -1 }).exec();
        return seances
    } catch (err) {
        console.error("Error fetching seance names:", err);
        throw err;
    }
}


/**
 * Get a seance by id
 * @param {string} id - The ID of the seance.
 * @returns {Promise<Object>} - A promise that resolves to the seance object.
 */
async function getSeance(id) {
    try {
        const seance = await
            Seance.findById(id).exec();
        return seance;
    } catch (err) {
        console.error("Error fetching seance:", err);
        throw err;
    }
}


/**
 * Fetches all seances.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of seance objects.
 * @throws {Error} - If an error occurs while fetching seances.
*/
async function getSeances() {
    try {
        // limit at 20, sort by date -1
        const seances = await Seance.aggregate([
            { $sort: { date: -1 } },
            { $limit: 5 }
        ]).exec();
        return seances;
    }
    catch (err) {
        console.error("Error fetching seances:", err);
        throw err;
    }
}


/**
 * Create a new seance.
 * @param {Object} seanceData - The seance data.
 * @returns {Promise<Object>} - A promise that resolves to the newly created seance object.
 */
async function createSeance(seanceData) {
    try {
        Seance.init();
        const newSeance = new Seance(seanceData);
        await newSeance.save();
        return newSeance;
    } catch (err) {
        console.error("Error creating seance:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getLastSeance, getSeanceNames, getSeance, getSeances, createSeance };

// (async () => {
//     try {
//         // Connect to MongoDB (update connection string as necessary)
//         mongoose.connect(process.env.mongoURL + '/prograrmor', {
//             useNewUrlParser: true,
//             useUnifiedTopology: true
//         });
//         // Define the parameters
//         const userId = '6365489f44d4b4000470882b'; // Replace with the actual user ID
//         const seanceName = 'Volume FB B'; // Optional seance name to filter (can be omitted)
//         const field = 'date'; // Sort by 'date' or 'createdAt'

//         // Call getLastSeance function
//         const lastSeance = await getLastSeance(userId, field, seanceName);
//         console.log("Last Seance:", lastSeance);

//         // Call getSeanceNames function
//         const seanceNames = await getSeanceNames(userId);
//         console.log("Seance Names:", seanceNames);
//     } catch (err) {
//         console.error("Error:", err);
//     } finally {
//         // Close the MongoDB connection
//         await mongoose.connection.close();
//     }
// })();

