const mongoose = require('mongoose');
const ExerciceType = require('../schema/exercicetype'); // Adjust the path as needed
const { getOrSetCache, invalidateCacheStartingWith } = require('../utils/cache');
const { normalizeString } = require('../utils/string');

/**
 * Fetches all exercice types from the database.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercice type objects.
 */
async function getAllExerciceTypes(page = 1, limit = 7) {
    try {
        const cacheKey = `exerciceTypes_all:${page}:${limit}`;
        return await getOrSetCache(cacheKey, async () => {
            const total = await ExerciceType.countDocuments();
            const exerciceTypes = await ExerciceType.find()
                .sort({ "popularityScore": -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .exec();

            return { exerciceTypes, total };
        });
    } catch (err) {
        console.error("Error fetching exercice types:", err);
        throw err;
    }
}

/**
 * Fetches an exercice type by its ID or name.
 * @param {string} id - The ID of the exercice type.
 * @param {string} [name] - The name of the exercice type.
 * @param {string} [fields] - Optional fields to include in the response
 * @returns {Promise<Object>} - A promise that resolves to the exercice type object.
 */
async function getExerciceType(id, name, fields) {
    try {
        const cacheKey = `exerciceType_${id || ''}_${name || ''}_${fields || ''}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {};

            if (id) {
                query._id = new mongoose.Types.ObjectId(id);
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
        console.error("Error fetching exercice type:", err);
        throw err;
    }
}

/**
 * Creates a new exercice type
 * @param {Object} data - The exercice type data
 * @returns {Promise<Object>} - The created exercice type
 */
async function createExerciceType(data) {
    try {
        const exerciceType = new ExerciceType({
            _id: new mongoose.Types.ObjectId(),
            name: {
                fr: data.nameFr,
                en: data.nameEn
            },
            popularityScore: data.popularityScore || 0,
            normalizedName: {
                fr: normalizeString(data.nameFr),
                en: normalizeString(data.nameEn)
            },
            examples: {
                fr: data.examplesFr.filter(ex => ex),
                en: data.examplesEn.filter(ex => ex)
            }
        });

        await exerciceType.save();

        //reset cache
        await invalidateCacheStartingWith('exerciceTypes_all');
        await invalidateCacheStartingWith('exerciceType_');

        return exerciceType;
    } catch (err) {
        console.error("Error creating exercice type:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllExerciceTypes, getExerciceType, createExerciceType };
