const mongoose = require('mongoose');
const Seance = require('../schema/seance'); // Adjust the path as needed
const { getOrSetCache } = require('../controllers/utils/cache');
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
        const cacheKey = `lastSeance_${userId}_${field || 'date'}_${seanceName || 'all'}`;
        return await getOrSetCache(cacheKey, async () => {
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
        });
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
        const cacheKey = `seanceNames_${userId}`;
        return await getOrSetCache(cacheKey, async () => {
            const seances = await Seance.find({ user: mongoose.Types.ObjectId(userId) }, ["name", "date"]).sort({ date: -1 }).exec();
            return seances;
        });
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
        const cacheKey = `seance_${id}`;
        return await getOrSetCache(cacheKey, async () => {
            const seance = await Seance.findById(id).exec();
            return seance;
        });
    } catch (err) {
        console.error("Error fetching seance:", err);
        throw err;
    }
}


/**
 * Fetches all seances.
 * @param {string} user - The ID of the user.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of seance objects.
 * @throws {Error} - If an error occurs while fetching seances.
*/
async function getSeances(user) {
    try {
        const cacheKey = `seances_${user || 'all'}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {}
            if (user) {
                query = { user: mongoose.Types.ObjectId(user) }
            }
            const seances = await Seance.aggregate([
                { $match: query },
                { $sort: { date: -1 } },
                { $limit: 3 }
            ]).exec();
            return seances;
        });
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

        // Invalidate relevant caches
        await invalidateCacheStartingWith(`seances_${seanceData.user}`);
        await invalidateCache(`seance_${newSeance._id}`);
        await invalidateCacheStartingWith(`lastSeance_${seanceData.user}`);

        return newSeance;
    } catch (err) {
        console.error("Error creating seance:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getLastSeance, getSeanceNames, getSeance, getSeances, createSeance };

