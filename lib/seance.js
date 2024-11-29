const mongoose = require('mongoose');
const Seance = require('../schema/seance'); // Adjust the path as needed
const Set = require('../schema/seanceset');
const { getOrSetCache, invalidateSeanceCaches } = require('../controllers/utils/cache');
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
            const seances = await Seance.find({ user: mongoose.Types.ObjectId(userId) }, ["name", "date", "title", "description", "_id"]).sort({ date: -1 }).exec();
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
 * @param {number} page - The page number.
 * @param {number} limit - The number of seances per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of seance objects.
 * @throws {Error} - If an error occurs while fetching seances.
*/
async function getSeances(user, page = 1, limit = 3) {
    try {
        const skip = (page - 1) * limit;
        const cacheKey = `seances_${user || 'all'}_${page}`;

        return await getOrSetCache(cacheKey, async () => {
            let query = {}
            if (user) {
                query = { user: mongoose.Types.ObjectId(user) }
            }

            // Get total count for pagination
            const total = await Seance.countDocuments(query);

            const seances = await Seance.aggregate([
                { $match: query },
                { $sort: { date: -1 } },
                { $skip: skip },
                { $limit: limit }
            ]).exec();

            return {
                seances,
                hasMore: total > skip + limit,
                total
            };
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
        await invalidateSeanceCaches(seanceData.user, newSeance._id);

        return newSeance;
    } catch (err) {
        console.error("Error creating seance:", err);
        throw err;
    }
}

/**
 * Delete a seance by id, also deletes the sets associated with the seance
 * @param {string} id - The ID of the seance.
 * @param {string} user - The ID of the user.
 * @returns {Promise<void>} - A promise that resolves when the seance and associated sets are deleted.
 */
async function deleteSeance(id, user) {
    try {
        if (!user) {
            throw new Error("User ID is required");
        }
        if (!id) {
            throw new Error("Seance ID is required");
        }
        await Seance.findByIdAndDelete(id);
        await Set.deleteMany({ seance: id });
        console.log("Seance and associated sets deleted", id, user);

        // Invalidate relevant caches
        await invalidateSeanceCaches(user, id);
    } catch (err) {
        console.error("Error deleting seance:", err);
        throw err;
    }
}

/**
 * Update a seance
 * @param {string} id - The ID of the seance.
 * @param {Object} seanceData - The seance data.
 * @returns {Promise<Object>} - A promise that resolves to the updated seance object.
 */
async function updateSeance(id, seanceData) {
    try {
        console.log("Updating seance:", id, seanceData);
        // Extract _id from seanceData if present to avoid casting errors
        const { _id, ...updateData } = seanceData;

        const updatedSeance = await Seance.findByIdAndUpdate(id, updateData, { new: true });
        // Invalidate relevant caches
        await invalidateSeanceCaches(seanceData.user, id);

        return updatedSeance;
    } catch (err) {
        console.error("Error updating seance:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getLastSeance, getSeanceNames, getSeance, getSeances, createSeance, deleteSeance, updateSeance };

