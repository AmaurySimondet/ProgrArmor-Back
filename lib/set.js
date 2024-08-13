const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();

/**
 * Fetches all sets given parameters.
 * @param {string} userId - The ID of the user.
 * @param {string} seanceId - The ID of the seance.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of set objects.
 */
async function getSets(userId, seanceId) {
    try {
        console.log("Fetching all sets", userId, seanceId);
        const sets = await Set.find({ user: mongoose.Types.ObjectId(userId), seance: mongoose.Types.ObjectId(seanceId) }).exec();
        console.log(sets);
        return sets;
    } catch (err) {
        console.error("Error fetching sets:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getSets };

