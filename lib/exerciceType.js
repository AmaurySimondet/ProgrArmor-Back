const mongoose = require('mongoose');
const ExerciceType = require('../schema/exercicetype'); // Adjust the path as needed
const { getOrSetCache } = require('../controllers/utils/cache');

/**
 * Fetches all exercise types from the database.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercise type objects.
 */
async function getAllExerciceTypes() {
    try {
        const cacheKey = 'exerciseTypes_all';
        return await getOrSetCache(cacheKey, async () => {
            const exerciceTypes = await ExerciceType.find().sort({ "popularityScore": -1 }).exec();
            return exerciceTypes;
        });
    } catch (err) {
        console.error("Error fetching exercise types:", err);
        throw err;
    }
}

/**
 * Fetches an exercise type by its ID or name.
 * @param {string} id - The ID of the exercise type.
 * @param {string} [name] - The name of the exercise type.
 * @param {string} [fields] - Optional fields to include in the response
 * @returns {Promise<Object>} - A promise that resolves to the exercise type object.
 */
async function getExerciceType(id, name, fields) {
    try {
        const cacheKey = `exerciseType_${id || ''}_${name || ''}_${fields || ''}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {};

            if (id) {
                query._id = mongoose.Types.ObjectId(id);
            }

            if (name) {
                query["$or"] = [{ "name.fr": name }, { "name.en": name }];
            }

            const exerciceType = await ExerciceType.findOne(query).select(fields).exec();

            if (!exerciceType) {
                throw new Error("Exercise type not found");
            }

            return exerciceType;
        });
    } catch (err) {
        console.error("Error fetching exercise type:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllExerciceTypes, getExerciceType };
