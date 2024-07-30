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
        const seances = await Seance.find({ user: mongoose.Types.ObjectId(userId) }, 'name').sort({ date: -1 }).exec();
        const uniqueNames = [...new Set(seances.map(seance => seance.name))];

        return uniqueNames;
    } catch (err) {
        console.error("Error fetching seance names:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getLastSeance, getSeanceNames };

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

