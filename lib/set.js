const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();
const { compareAndAssignPR } = require('../utils/set');
const { invalidateSetCaches, getOrSetCache, invalidateSeanceCaches } = require('../utils/cache');

const THREE_MONTHS = 90 * 24 * 60 * 60 * 1000;

/**
 * Fetches all sets given parameters.
 * @param {string} userId - The ID of the user.
 * @param {string} excludedSeanceId - The ID of the seance to exclude.
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
 * @param {string} variations - Optional variations to filter by
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of set objects.
 */
async function getSets(userId, excludedSeanceId, seanceId, exercice, categories, unit, value, weightLoad, elasticTension, dateMin, dateMax, fields, variations) {
    try {
        // Properly serialize variations for cache key
        const variationsKey = variations ? JSON.stringify(variations) : '';
        const categoriesKey = categories ? JSON.stringify(categories) : '';
        const cacheKey = `sets_${userId || ''}_${excludedSeanceId || ''}_${seanceId || ''}_${exercice || ''}_${categoriesKey || ''}_${unit || ''}_${value || ''}_${weightLoad || ''}_${elasticTension || ''}_${dateMin || ''}_${dateMax || ''}_${fields || ''}_${variationsKey}`;
        return await getOrSetCache(cacheKey, async () => {
            const query = {};
            if (userId) {
                query.user = new mongoose.Types.ObjectId(userId);
            }
            if (excludedSeanceId) {
                query.seance = { $ne: new mongoose.Types.ObjectId(excludedSeanceId) };
            }
            if (seanceId) {
                query.seance = new mongoose.Types.ObjectId(seanceId);
            }
            if (exercice) {
                query.exercice = new mongoose.Types.ObjectId(exercice);
            }
            if (categories) {
                let categoriesJson = categories.map(c => JSON.parse(c)); // Parse each string individually
                if (!Array.isArray(categoriesJson)) {
                    categoriesJson = [categoriesJson];
                }

                const categoryIds = categoriesJson.map(c => new mongoose.Types.ObjectId(c.category));

                // Create a query that matches documents where the `categories` array contains only the specified categories
                query.categories = {
                    $size: categoryIds.length,  // Ensures the array has the exact number of elements
                    $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
                };
            }
            if (variations) {
                let variationsJson;

                // Check if variations are already objects or need to be parsed
                if (typeof variations[0] === 'string') {
                    variationsJson = variations.map(v => JSON.parse(v)); // Parse each string individually
                } else {
                    variationsJson = variations; // Already objects
                }

                if (!Array.isArray(variationsJson)) {
                    variationsJson = [variationsJson];
                }

                const variationIds = variationsJson.map(v => new mongoose.Types.ObjectId(v.variation));

                query.variations = {
                    $size: variationIds.length,
                    $all: variationIds.map(id => ({ $elemMatch: { variation: id } }))
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
 * @param {string} seanceName - Optional seance name to filter by
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top exercises.
 */
async function getTopExercices(userId, by, asc, page = 1, limit = 3, seanceName = null) {
    try {
        return await getOrSetCache(`topExercices:${userId}:${by}:${asc}:${page}:${limit}:${seanceName || ''}`, async () => {
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
                // First lookup seance details
                {
                    $lookup: {
                        from: 'seances',
                        localField: 'seance',
                        foreignField: '_id',
                        as: 'seanceDetails'
                    }
                },
                {
                    $match: {
                        user: new mongoose.Types.ObjectId(userId),
                        date: { $gte: new Date(Date.now() - THREE_MONTHS) },
                        ...(seanceName && { 'seanceDetails.name': seanceName })
                    }
                },
                // grouping
                { $group: { _id: ['$exercice', '$categories.category'], total: { $sum: groupBy }, seances: { $addToSet: "$seance" } } },
                {
                    $addFields: {
                        seancesSize: { $size: "$seances" }
                    }
                },
                {
                    '$project': {
                        exercice: { '$arrayElemAt': ['$_id', 0] },   // Extract the first element as 'exercice'
                        categories: { '$arrayElemAt': ['$_id', 1] }, // Extract the second element as 'categories'
                        total: 1,  // Include 'total' in the final output
                        seancesSize: 1,
                        _id: 0
                    }
                },
                { $sort: { [totalField]: sort, exercice: 1, categories: 1 } },
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
 * @param {string} exercice - The ID of the exercice.
 * @param {Array<string>} categories - The array of category IDs.
 * @param {number} page - The page number to fetch.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top formats with their occurrences.
 */
async function getLastFormats(userId, exercice, categories, page = 1, limit = 5) {
    try {
        const cacheKey = `lastFormats_${userId}_${exercice}_${categories}_${page}_${limit}`;
        let match = { user: new mongoose.Types.ObjectId(userId), date: { $gte: new Date(Date.now() - THREE_MONTHS) } };
        if (exercice) {
            match.exercice = new mongoose.Types.ObjectId(exercice);
        }
        if (categories) {
            match.categories = { $size: categories.length, $all: categories.map(c => ({ $elemMatch: { category: new mongoose.Types.ObjectId(c) } })) };
        }
        return await getOrSetCache(cacheKey, async () => {
            const agg = [
                // Step 1: Match documents by user ID
                { $match: match },

                {
                    $group: {
                        _id: {
                            exercice: "$exercice",
                            categories: "$categories.category",
                            seance: "$seance",
                            unit: "$unit"
                        },
                        sets: {
                            $push: "$$ROOT"
                        },
                        date: {
                            $first: "$date"
                        }
                    }
                },
                {
                    $project: {
                        "sets.value": 1,
                        "sets.elastic": 1,
                        "sets.weightLoad": 1,
                        "sets.unit": 1,
                        date: 1
                    }
                },
                {
                    $sort: {
                        date: -1
                    }
                }
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
            const lastFormats = await Set.aggregate(dataPipeline).exec();

            return { lastFormats: lastFormats, total };
        });
    } catch (err) {
        console.error("Error fetching last formats:", err);
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
async function getPRs(userId, exercice, categories, dateMin, variations) {
    try {
        const variationsKey = variations ? JSON.stringify(variations) : '';
        const categoriesKey = categories ? JSON.stringify(categories) : '';
        console.log("getPRs", userId, exercice, categories, dateMin, variations);
        const cacheKey = `prs_${userId}_${exercice || ''}_${categoriesKey || ''}_${variationsKey || ''}_${dateMin || ''}`;
        return await getOrSetCache(cacheKey, async () => {
            const query = { value: { $gt: 0 }, user: new mongoose.Types.ObjectId(userId) };
            if (exercice) {
                query.exercice = new mongoose.Types.ObjectId(exercice);
            }
            if (categories) {
                let categoriesJson = categories.map(c => JSON.parse(c)); // Parse each string individually
                if (!Array.isArray(categoriesJson)) {
                    categoriesJson = [categoriesJson];
                }

                const categoryIds = categoriesJson.map(c => new mongoose.Types.ObjectId(c.category));

                // Create a query that matches documents where the `categories` array contains only the specified categories
                query.categories = {
                    $size: categoryIds.length,  // Ensures the array has the exact number of elements
                    $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
                };
            }
            if (variations) {
                if (!Array.isArray(variations)) {
                    variations = [variations];
                }

                console.log("variations", variations);
                const variationIds = variations.map(v => new mongoose.Types.ObjectId(v)); // Changé ici
                console.log("variationIds", variationIds);

                query.variations = {
                    $size: variationIds.length,
                    $all: variationIds.map(id => ({ $elemMatch: { variation: id } }))
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
                Endurance: { repetitions: null, seconds: null },
                Last: { repetitions: null, seconds: null }
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

            // ajouter a prs.Last.repetitions et prs.Last.seconds le dernier set
            repSets = sets.filter(s => s.unit === 'repetitions');
            secSets = sets.filter(s => s.unit === 'seconds');
            prs.Last.repetitions = repSets[repSets.length - 1];
            prs.Last.seconds = secSets[secSets.length - 1];

            return prs;
        });
    } catch (err) {
        console.error("Error fetching PRs:", err);
        throw err;
    }
}

/**
 * Check if a set is a personal record
 * @param {string} userId id of the user
 * @param {string} seanceId id of the seance
 * @param {string} unit unit of the set
 * @param {number} value value of the set
 * @param {number} weightLoad weightLoad of the set
 * @param {object} elastic elastic object with the following structure: {use, tension}
 * @param {list} variations writen as [{variation: "id"}]
 * @returns {string} "PR" if it is a personal record, "SB" if it is the same best, "NB" if it is the first time recording this exercise, null if it is not a personal record
 */
async function isPersonalRecord(userId, seanceId, unit, value, weightLoad, elastic, variations) {
    console.log("isPersonalRecord", userId, seanceId, unit, value, weightLoad, elastic, variations);

    if (value === 0) return null; // Ignore sets with 0 reps

    // Call the API to check if this set is a personal record
    try {
        // Check if this is the first time recording this exercise
        const allSetsQuery = {
            excludedSeanceId: seanceId,
            userId,
            variations
        };
        const allSets = await getSets(allSetsQuery);
        if (allSets.data.sets.length === 0) {
            return "NB"; // New Best - first time recording this exercise
        }

        // Filter sets that are better or equal to the current set
        let sets = allSets.data.sets.filter(s => {
            if (unit && s.unit !== unit) return false;
            if (value && s.value <= value) return false;
            if (weightLoad && s.weightLoad <= weightLoad) return false;
            if (elastic && elastic.use && s.elastic && s.elastic.use) {
                if (elastic.use === "resistance" && s.elastic.tension <= elastic.tension) return false;
                if (elastic.use === "assistance" && s.elastic.tension >= elastic.tension) return false;
            }
            return true;
        });

        // Check if the set is a personal record
        if (sets.length === 0) {
            return "PR";
        }
        else {
            // Find the best set from sets (highest value, weightLoad, or elastic tension)
            const bestSet = sets.reduce((best, current) => {
                if (current.value > best.value) return current;
                if (current.weightLoad > best.weightLoad) return current;
                if (current.elastic && current.elastic.tension > best.elastic.tension) return current;
                return best;
            });

            // Check if the current set is the best set using values
            let isBestSet = true;
            if (value && bestSet.value > value) isBestSet = false;
            if (weightLoad && bestSet.weightLoad > weightLoad) isBestSet = false;
            if (elastic && elastic.use && elastic.use === "resistance") {
                if (bestSet.elastic && bestSet.elastic.tension > elastic.tension) isBestSet = false;
            }
            if (elastic && elastic.use && elastic.use === "assistance") {
                if (bestSet.elastic && bestSet.elastic.tension < elastic.tension) isBestSet = false;
            }

            if (isBestSet) {
                return "SB";
            }
        }

        return null; // Not a PR


    } catch (error) {
        console.error('Error checking for personal record:', error);
        return false; // Handle errors by returning false (not a PR)
    }
};



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
module.exports = { getSets, getTopExercices, createSet, getPRs, getLastFormats, deleteSets, isPersonalRecord };

