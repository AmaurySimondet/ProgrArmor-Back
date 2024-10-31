const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();

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
 * @param {string} fields - Optional fields to include in the response
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of set objects.
 */
async function getSets(userId, seanceId, exercice, categories, unit, value, weightLoad, elastic) {
    try {
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
        if (elastic) {
            query.elastic = JSON.parse(elastic);
        }
        console.log("Query for sets:", query);
        const sets = await Set.find(query).sort({ exerciceOrder: 1, setOrder: 1 }).exec();
        console.log("Sets found:", sets.length);
        return sets;
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
async function getTopExercices(userId, by, asc) {
    try {
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
        const agg = [[
            { $match: { user: mongoose.Types.ObjectId(userId) } },

            // filtering on dates
            { $group: { _id: null, lastRecordedDate: { $max: "$date" } } },
            {
                // Step 2: Calculate six weeks before this latest date
                $addFields: {
                    cutoffDate: {
                        $dateSubtract: {
                            startDate: "$lastRecordedDate",
                            unit: "week",
                            amount: 3 * 4
                        }
                    }
                }
            },
            {
                // Step 3: Match documents with dates after the cutoff date
                $lookup: {
                    from: "seancesets",
                    as: "filteredSets",
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $gte: ["$date", "$$cutoffDate"]
                                },
                                user: mongoose.Types.ObjectId(userId)
                            }
                        }
                    ],
                    let: { cutoffDate: "$cutoffDate" }
                }
            },
            { $unwind: "$filteredSets" },
            { $replaceRoot: { newRoot: "$filteredSets" } },

            // grouping
            { $group: { _id: ['$exercice', '$categories'], total: { $sum: groupBy }, seances: { $addToSet: "$seance" } } },
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
        ]];
        console.log("Aggregation pipeline:", agg, { _id: ['$exercice', '$categories'], total: { $sum: groupBy } }, { $sort: { [totalField]: sort } });
        const topExercices = await Set.aggregate(agg).exec();
        return topExercices;
    } catch (err) {
        console.error("Error fetching top exercises:", err);
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
        const newSet = await Set.create(setData);
        return newSet;
    } catch (err) {
        console.error("Error creating set:", err);
        throw err;
    }
}

/**
 * Get PRs for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} exercice - The ID of the exercice.
 * @param {Array<string>} categories - The array of category IDs.
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
async function getPRs(userId, exercice, categories) {
    try {
        const query = {
            user: mongoose.Types.ObjectId(userId),
        };
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

        // Fetch all sets that match the query
        const sets = await Set.find(query).exec();
        console.log("Sets found for prs:", sets);

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

        console.log("PRs found:", prs);

        return prs;
    } catch (err) {
        console.error("Error fetching PRs:", err);
        throw err;
    }
}

/**
 * Helper function to compare and assign PR.
 * @param {Object|null} currentPR - The current PR to compare against.
 * @param {Object} newSet - The new set to compare with the current PR.
 * @returns {Object} - The updated PR if the new set is higher, otherwise the current PR.
 */
function compareAndAssignPR(currentPR, newSet) {
    if (!currentPR) {
        return {
            value: newSet.value,
            weightLoad: newSet.weightLoad,
            elastic: newSet.elastic
        };
    }
    // Replace the PR only if the weightLoad or elastic is higher or if the value itself is higher
    if (
        newSet.weightLoad > currentPR.weightLoad ||
        (newSet.elastic && newSet.elastic.tension > currentPR.elastic?.tension)
    ) {
        return {
            value: newSet.value,
            weightLoad: newSet.weightLoad,
            elastic: newSet.elastic
        };
    }
    return currentPR;
}


// Export the functions
module.exports = { getSets, getTopExercices, createSet, getPRs };

