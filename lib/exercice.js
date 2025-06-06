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
 * Fetches exercises matching the search term using Atlas Search
 */
async function getExercicesForCombination(search) {
    try {
        if (!search) {
            return await Exercice.find().exec();
        }

        return await Exercice.aggregate([
            {
                $search: {
                    index: "exercices_name_fr",
                    compound: {
                        should: [
                            {
                                autocomplete: {
                                    query: search,
                                    path: "name.fr",
                                    fuzzy: {
                                        maxEdits: 1,
                                        prefixLength: 0, // Start matching from the first character
                                    }
                                }
                            },
                            {
                                text: {
                                    query: search,
                                    path: "name.fr",
                                    fuzzy: {
                                        maxEdits: 1,
                                        prefixLength: 0
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        ]).exec();
    } catch (err) {
        console.error("Error searching exercises:", err);
        throw err;
    }
}



/**
 * Fetches categories matching the search term using Atlas Search
 */
async function getCategoriesForCombination(search) {
    try {
        if (!search) {
            // If no search term, return categories with type filter
            return await Categorie.find().exec();
        }

        return await Categorie.aggregate([
            {
                $search: {
                    "index": "categories_search",
                    "text": {
                        "query": search,
                        "path": "name.fr",
                        "fuzzy": {
                            "maxEdits": 2,
                            "prefixLength": 1,
                            "maxExpansions": 50
                        },
                    }
                }
            }
        ]).exec();
    } catch (err) {
        console.error("Error searching categories:", err);
        throw err;
    }
}

/**
 * Fetches all combinations from the database using Atlas Search.
 * @param {number} page - Page number for pagination
 * @param {number} limit - Number of items per page
 * @param {string} search - Search term to filter combinations
 * @returns {Promise<Object>} - A promise that resolves to { combinations, total }
 */
async function getCombinations(page = 1, limit = 7, search = '') {
    try {
        return await getOrSetCache(`combinations:${page}:${limit}:${search}`, async () => {
            // Get matching exercises and categories
            const [exercices, categories] = await Promise.all([
                getExercicesForCombination(search),
                getCategoriesForCombination(search)
            ]);

            let allCombinations = [];

            // First add exercises with no category as a combination
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

            // Then add exercises with categories
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

<<<<<<< HEAD
=======
            // Filter by search term if provided
            if (search) {
                const normalizedSearch = normalizeString(search);
                allCombinations = allCombinations.filter(combo =>
                    combo.combinationNameNormalized.fr.includes(normalizedSearch) ||
                    combo.combinationNameNormalized.en.includes(normalizedSearch)
                );
            }

>>>>>>> master
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
