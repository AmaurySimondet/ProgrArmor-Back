const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();
const { compareAndAssignPR } = require('../utils/set');
const { invalidateSetCaches, getOrSetCache, invalidateSeanceCaches } = require('../utils/cache');

const THREE_MONTHS = 90 * 24 * 60 * 60 * 1000;

/**
 * Fetches all sets given parameters.
 * @param {string} userId - The ID of the user.
 * @param {string} seanceId - The ID of the seance.
 * @param {string} exercice - The ID of the exercice.
 * @param {string} categories - The ID of the categories.
 * @param {string} unit - The unit of the value.
 * @param {string} value - The value of the set.
 * @param {string} weightLoad - The weight load of the set.
 * @param {string} elastic - The elastic of the set.
 * @param {string} dateMin - The minimum date of the set.
 * @param {string} dateMax - The maximum date of the set.
 * @param {string} fields - Optional fields to include in the response
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of set objects.
 */
async function getSets(userId, seanceId, exercice, categories, unit, value, weightLoad, elasticTension, dateMin, dateMax, fields) {
    try {
        const cacheKey = `sets_${userId || ''}_${seanceId || ''}_${exercice || ''}_${categories || ''}_${unit || ''}_${value || ''}_${weightLoad || ''}_${elasticTension || ''}_${dateMin || ''}_${dateMax || ''}_${fields || ''}`;

        return await getOrSetCache(cacheKey, async () => {
            const query = {};
            if (userId) {
                query.user = mongoose.Types.ObjectId(userId);
            }
            if (seanceId) {
                query.seance = mongoose.Types.ObjectId(seanceId);
            }
            if (exercice) {
                query.exercice = mongoose.Types.ObjectId(exercice);
            }
            if (categories) {
                let categoriesJson = categories.map(c => JSON.parse(c)); // Parse each string individually
                if (!Array.isArray(categoriesJson)) {
                    categoriesJson = [categoriesJson];
                }

                const categoryIds = categoriesJson.map(c => mongoose.Types.ObjectId(c.category));

                // Create a query that matches documents where the `categories` array contains only the specified categories
                query.categories = {
                    $size: categoryIds.length,  // Ensures the array has the exact number of elements
                    $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
                };
            }
            if (unit) {
                query.unit = unit;
            }
            if (value) {
                query.value = JSON.parse(value);
            }
            if (weightLoad) {
                query.weightLoad = JSON.parse(weightLoad);
            }
            if (elasticTension) {
                query['elastic.tension'] = JSON.parse(elasticTension);
            }
            if (dateMin) {
                if (dateMax) {
                    query.date = { $gte: new Date(dateMin), $lte: new Date(dateMax) };
                }
                else {
                    query.date = { $gte: new Date(dateMin) };
                }
            }
            if (dateMax) {
                query.date = { $lte: new Date(dateMax) };
            }
            const sets = await Set.find(query)
                .sort({
                    date: 1,          // Sort by date ascending (oldest first)
                    exerciceOrder: 1, // Then by exercice order ascending
                    setOrder: 1         // Then by set order ascending
                })
                .exec();
            return sets;
        });
    } catch (err) {
        console.error("Error fetching sets:", err);
        throw err;
    }
}

/**
 * Fetches the top exercises for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} by - Optional parameter to specify the field to group by
 * @param {string} asc - Optional parameter to specify the sort order
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top exercises.
 */
async function getTopExercices(userId, by, asc, page = 1, limit = 3) {
    try {
        return await getOrSetCache(`topExercices:${userId}:${by}:${asc}:${page}:${limit}`, async () => {
            let groupBy = "$seance";
            let sort = -1
            let totalField = "total";
            if (by) {
                if (by === "repetitions") {
                    groupBy = "$value";
                }
                else if (by === "weightLoad") {
                    groupBy = "$weightLoad";
                }
                else if (by === "elastic") {
                    groupBy = "$elastic";
                }
            }
            if (groupBy === "$seance") {
                groupBy = 1;
                totalField = "seancesSize";
            }
            if (asc) {
                sort = 1
            }
            const agg = [
                {
                    $match: {
                        user: mongoose.Types.ObjectId(userId),
                        // date: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
                    }
                },

                // grouping
                { $group: { _id: ['$exercice', '$categories.category'], total: { $sum: groupBy }, seances: { $addToSet: "$seance" } } },
                {
                    $addFields: {
                        seancesSize: { $size: "$seances" }
                    }
                },
                { $sort: { [totalField]: sort } },
                {
                    '$project': {
                        exercice: { '$arrayElemAt': ['$_id', 0] },   // Extract the first element as 'exercice'
                        categories: { '$arrayElemAt': ['$_id', 1] }, // Extract the second element as 'categories'
                        total: 1,  // Include 'total' in the final output
                        seancesSize: 1,
                        _id: 0
                    }
                },
            ];

            // Add pagination to the aggregation pipeline
            const countPipeline = [...agg, { $count: 'total' }];
            const dataPipeline = [...agg,
            { $skip: (page - 1) * limit },
            { $limit: limit }
            ];

            const [countResult, topExercices] = await Promise.all([
                Set.aggregate(countPipeline).exec(),
                Set.aggregate(dataPipeline).exec()
            ]);

            const total = countResult[0]?.total || 0;

            return {
                topExercices,
                total
            };
        });
    } catch (err) {
        console.error("Error fetching top exercises:", err);
        throw err;
    }
}

/**
 * Get the top formats for a user and optionally a specific exercise.
 * @param {string} userId - The ID of the user.
 * @param {number} page - The page number to fetch.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top formats with their occurrences.
 */
async function getTopFormat(userId, page = 1, limit = 5) {
    try {
        const cacheKey = `topFormat_${userId}_${page}_${limit}`;
        return await getOrSetCache(cacheKey, async () => {
            const agg = [
                // Step 1: Match documents by user ID
                { $match: { user: mongoose.Types.ObjectId(userId), date: { $gte: new Date(Date.now() - THREE_MONTHS) } } },

                // Step 3: Group sets by exercise, categories, seance, and unit to create seance-specific formats
                {
                    $group: {
                        _id: {
                            exercice: "$exercice",
                            categories: "$categories.category",
                            seance: "$seance",
                            unit: "$unit"
                        },
                        sets: { $push: "$value" }
                    }
                },

                // Step 4: Format the sets array to show occurrences of each format
                {
                    $group: {
                        _id: {
                            unit: "$_id.unit",
                            format: "$sets"
                        },
                        occurrence: { $sum: 1 }
                    }
                },

                // Step 5: Project only the necessary fields
                {
                    $project: {
                        format: "$_id.format",
                        unit: "$_id.unit",
                        occurrence: 1,
                        _id: 0
                    }
                },

                // Step 6: Match only the formats where all values in the array are the same
                {
                    $match: {
                        $expr: {
                            $eq: [
                                { $size: { $setUnion: ["$format"] } },
                                1
                            ]
                        }
                    }
                },

                // Step 7: Sort by the highest occurrence
                { $sort: { occurrence: -1 } },
            ];

            // Execute aggregation for total count
            const countPipeline = [...agg, { $count: 'total' }];
            const [countResult] = await Set.aggregate(countPipeline).exec();
            const total = countResult?.total || 0;

            // Execute aggregation with pagination
            const dataPipeline = [...agg,
            { $skip: (page - 1) * limit },
            { $limit: limit }
            ];
            const topFormats = await Set.aggregate(dataPipeline).exec();

            return { topFormat: topFormats, total };
        });
    } catch (err) {
        console.error("Error fetching top formats:", err);
        throw err;
    }
}

/**
 * Get PRs for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} exercice - The ID of the exercice.
 * @param {Array<string>} categories - The array of category IDs.
 * @param {string} dateMin - The minimum date of the sets.
 * @returns {Promise<Object>} - A promise that resolves to an object containing PRs categorized by 'Puissance', 'Force', 'Volume', and 'Endurance'.
 * 
 * The result format will be:
 * {
 *    "Puissance": { repetitions: { value, weightLoad, elastic }, seconds: { value, weightLoad, elastic }},
 *    "Force": { repetitions: { value, weightLoad, elastic }, seconds: { value, weightLoad, elastic }},
 *    "Volume": { repetitions: { value, weightLoad, elastic }, seconds: { value, weightLoad, elastic }},
 *    "Endurance": { repetitions: { value, weightLoad, elastic }, seconds: { value, weightLoad, elastic }}
 * }
 *
 * Classification based on reps/seconds:
 *  - Puissance: 1-3 reps or 1-10 secs
 *  - Force: 3-6 reps or 10-30 secs
 *  - Volume: 6-12 reps or 30 secs-1 min
 *  - Endurance: >12 reps or >1 min
 */
async function getPRs(userId, exercice, categories, dateMin) {
    try {
        const cacheKey = `prs_${userId}_${exercice || ''}_${categories ? JSON.stringify(categories) : ''}_${dateMin || ''}`;
        return await getOrSetCache(cacheKey, async () => {
            const query = { value: { $gt: 0 }, user: mongoose.Types.ObjectId(userId) };
            if (exercice) {
                query.exercice = mongoose.Types.ObjectId(exercice);
            }
            if (categories) {
                let categoriesJson = categories.map(c => JSON.parse(c)); // Parse each string individually
                if (!Array.isArray(categoriesJson)) {
                    categoriesJson = [categoriesJson];
                }

                const categoryIds = categoriesJson.map(c => mongoose.Types.ObjectId(c.category));

                // Create a query that matches documents where the `categories` array contains only the specified categories
                query.categories = {
                    $size: categoryIds.length,  // Ensures the array has the exact number of elements
                    $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
                };
            }
            if (dateMin) {
                query.date = { $gte: new Date(dateMin) };
            }

            // Fetch all sets that match the query
            const sets = await Set.find(query).exec();

            // Initialize the PR result object
            const prs = {
                Puissance: { repetitions: null, seconds: null },
                Force: { repetitions: null, seconds: null },
                Volume: { repetitions: null, seconds: null },
                Endurance: { repetitions: null, seconds: null }
            };


            sets.forEach(set => {
                // Check PRs based on repetitions
                if (set.unit === 'repetitions') {
                    if (set.value <= 3) {
                        // Puissance
                        prs.Puissance.repetitions = compareAndAssignPR(prs.Puissance.repetitions, set);
                    } else if (set.value <= 6) {
                        // Force
                        prs.Force.repetitions = compareAndAssignPR(prs.Force.repetitions, set);
                    } else if (set.value <= 12) {
                        // Volume
                        prs.Volume.repetitions = compareAndAssignPR(prs.Volume.repetitions, set);
                    } else {
                        // Endurance
                        prs.Endurance.repetitions = compareAndAssignPR(prs.Endurance.repetitions, set);
                    }
                }

                // Check PRs based on time (seconds)
                if (set.unit === 'seconds') {
                    if (set.value <= 10) {
                        // Puissance
                        prs.Puissance.seconds = compareAndAssignPR(prs.Puissance.seconds, set);
                    } else if (set.value <= 30) {
                        // Force
                        prs.Force.seconds = compareAndAssignPR(prs.Force.seconds, set);
                    } else if (set.value <= 60) {
                        // Volume
                        prs.Volume.seconds = compareAndAssignPR(prs.Volume.seconds, set);
                    } else {
                        // Endurance
                        prs.Endurance.seconds = compareAndAssignPR(prs.Endurance.seconds, set);
                    }
                }
            });

            return prs;
        });
    } catch (err) {
        console.error("Error fetching PRs:", err);
        throw err;
    }
}


/**
 * Create a new set.
 * @param {Object} setData - The set data.
 * @returns {Promise<Object>} - A promise that resolves to the new set object.
 */
async function createSet(setData) {
    try {
        // Invalidate all relevant caches
        await invalidateSetCaches(setData.user);
        await invalidateSeanceCaches(setData.user, setData.seance);

        const newSet = await Set.create(setData);
        return newSet;
    } catch (err) {
        console.error("Error creating set:", err);
        throw err;
    }
}

/**
 * Delete sets of a seance
 * @param {string} seanceId - The ID of the seance.
 */
async function deleteSets(seanceId) {
    try {
        await Set.deleteMany({ seance: seanceId });
        // Invalidate relevant caches
        await invalidateSetCaches(seanceId);
        await invalidateSeanceCaches(seanceId);
    } catch (err) {
        console.error("Error deleting sets:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getSets, getTopExercices, createSet, getPRs, getTopFormat, deleteSets };

