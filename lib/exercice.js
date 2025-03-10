const mongoose = require('mongoose');
const Exercice = require('../schema/exercice');
const Categorie = require('../schema/categorie');
const { getOrSetCache, invalidateCacheStartingWith } = require('../utils/cache');
const { normalizeString } = require('../utils/string');
/**
 * Fetches all exercices from the database.
 * @param {string} [exerciceType] - Optional exercise type to filter
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercise objects.
 */
async function getAllExercices(exerciceType) {
    try {
        const cacheKey = `exercices_${exerciceType || 'all'}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {};
            if (exerciceType) {
                query = { type: mongoose.Types.ObjectId(exerciceType) };
            }
            const exercices = await Exercice.find(query).exec();
            return exercices;
        });
    } catch (err) {
        console.error("Error fetching exercices:", err);
        throw err;
    }
}

/**
 * Fetches an exercise by its ID.
 * @param {string} id - Optional exercise type to filter
 * @param {string} name - Optional exercise name to filter
 * @param {string} fields - Optional fields to include in the response
 * @returns {Promise<Object>} - A promise that resolves to the exercise object.
 */
async function getExerciceById(id, name, fields) {
    try {
        const cacheKey = `exercise_${id || ''}_${name || ''}_${fields || ''}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {};
            if (id) {
                query = { _id: mongoose.Types.ObjectId(id) };
            } else if (name) {
                query = { "$or": [{ "name.fr": name }, { "name.en": name }] };
            }
            const exercice = await Exercice.findOne(query).select(fields).exec();
            return exercice;
        });
    } catch (err) {
        console.error("Error fetching exercise by ID:", err);
        throw err;
    }
}

/**
 * Fetches all combinations from the database.
 * should be like:
 * combination = { combinationName: {fr: exercice.name.fr + - + category.name.fr, en: same idea}, exercice: exercice, category: category}
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of combination objects.
 */
async function getCombinations(page = 1, limit = 7, search = '') {
    try {
        return await getOrSetCache(`combinations:${page}:${limit}:${search}`, async () => {
            const exercices = await Exercice.find().exec();
            const categories = await Categorie.find({
                "type": {
                    "$in": [
                        mongoose.Types.ObjectId("669cda3b33e75a33610be146"),
                        mongoose.Types.ObjectId("669cda3b33e75a33610be15c"),
                        mongoose.Types.ObjectId("669cda3b33e75a33610be158"),
                        mongoose.Types.ObjectId("669cda3b33e75a33610be154"),
                        mongoose.Types.ObjectId("669cda3b33e75a33610be15a"),
                        mongoose.Types.ObjectId("669cda3b33e75a33610be14f"),
                        mongoose.Types.ObjectId("669cda3b33e75a33610be155"),
                        mongoose.Types.ObjectId("669cda3b33e75a33610be159")
                    ]
                }
            }).exec();
            let allCombinations = [];

            // first add exercices with no category as a combination
            exercices.forEach(exercice => {
                let combination = {
                    combinationName: {
                        fr: exercice.name.fr,
                        en: exercice.name.en
                    },
                    combinationNameNormalized: {
                        fr: normalizeString(exercice.name.fr),
                        en: normalizeString(exercice.name.en)
                    },
                    exercice: exercice,
                    category: null
                };
                allCombinations.push(combination);
            });

            // then add exercices with categories
            exercices.forEach(exercice => {
                categories.forEach(category => {
                    let combination = {
                        combinationName: {
                            fr: exercice.name.fr + ' - ' + category.name.fr,
                            en: exercice.name.en + ' - ' + category.name.en
                        },
                        combinationNameNormalized: {
                            fr: normalizeString(exercice.name.fr + ' - ' + category.name.fr),
                            en: normalizeString(exercice.name.en + ' - ' + category.name.en)
                        },
                        exercice: exercice,
                        category: category
                    };
                    allCombinations.push(combination);
                });
            });

            // Filter by search term if provided
            if (search) {
                const normalizedSearch = normalizeString(search);
                allCombinations = allCombinations.filter(combo =>
                    combo.combinationNameNormalized.fr.includes(normalizedSearch) ||
                    combo.combinationNameNormalized.en.includes(normalizedSearch)
                );
            }

            const total = allCombinations.length;
            const start = (page - 1) * limit;
            const combinations = allCombinations.slice(start, start + limit);

            return { combinations, total };
        });
    } catch (err) {
        console.error("Error fetching combinations:", err);
        throw err;
    }
}

/**
 * Creates a new exercise
 * @param {Object} data - The exercise data
 * @returns {Promise<Object>} - The created exercise
 */
async function createExercice(data) {
    try {
        const exercice = new Exercice({
            _id: new mongoose.Types.ObjectId(),
            name: {
                fr: data.nameFr,
                en: data.nameEn
            },
            normalizedName: {
                fr: normalizeString(data.nameFr),
                en: normalizeString(data.nameEn)
            },
            type: mongoose.Types.ObjectId(data.associatedType),
        });

        await exercice.save();

        //reset cache
        await invalidateCacheStartingWith('exercices_');
        await invalidateCacheStartingWith('exercice_');
        await invalidateCacheStartingWith('combinations_');

        return exercice;
    } catch (err) {
        console.error("Error creating exercise:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllExercices, getExerciceById, getCombinations, createExercice };
