const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();
const { compareAndAssignPR } = require('../utils/set');
const { invalidateSetCaches, getOrSetCache, invalidateSeanceCaches } = require('../utils/cache');
const { normalizeString } = require('../utils/string');
const Variation = require('../schema/variation');

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
                        ...(seanceName && { 'seanceDetails.name': seanceName })
                    }
                },
                // grouping
                //TODO: Change by variations
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
 * Get the my exercices for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} search - The search query.
 * @param {number} page - The page number.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercices.
 */
async function getMyExercicesSearch(userId, search, page, limit) {
    try {
        const { MongoClient } = require('mongodb');
        const uri = process.env.mongoURL;
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db(process.env.DATABASE.split('/')[1]);
        const cacheKey = `myExercices_${userId}_${search}_${page}_${limit}`;
        return await getOrSetCache(cacheKey, async () => {
            const normalizedSearch = normalizeString(search);

            const userIdObjectId = mongoose.Types.ObjectId.isValid(userId)
                ? new mongoose.Types.ObjectId(userId)
                : userId;

            const compound = {
                should: [
                    {
                        autocomplete: {
                            query: normalizedSearch,
                            path: "mergedVariationsNames.fr",
                            fuzzy: {
                                maxEdits: 1,
                                prefixLength: 0,
                                maxExpansions: 50
                            },
                            score: { boost: { value: 1 } }
                        }
                    },
                    {
                        text: {
                            query: normalizedSearch,
                            path: "mergedVariationsNames.fr",
                            score: { boost: { value: 3 } },
                            // synonyms: "synonyms"
                        }
                    },
                    {
                        autocomplete: {
                            query: normalizedSearch,
                            path: "mergedVariationsNames.en",
                            fuzzy: {
                                maxEdits: 1,
                                prefixLength: 0,
                                maxExpansions: 50
                            },
                            score: { boost: { value: 1 } }
                        }
                    },
                    {
                        text: {
                            query: normalizedSearch,
                            path: "mergedVariationsNames.en",
                            // synonyms: "synonyms",
                            score: { boost: { value: 3 } }
                        }
                    }
                ],
                filter: [
                    {
                        equals: {
                            value: userIdObjectId,
                            path: "user"
                        }
                    }
                ],
                minimumShouldMatch: 1
            }
            const countPipeline = [
                {
                    $search: {
                        index: "default",
                        compound: compound
                    },
                },
                {
                    $group: {
                        _id: "$variations.variation",
                        count: { $sum: 1 }
                    }
                }
            ];
            const [variations, totalResult] = await Promise.all([
                db.collection('seancesets').aggregate([
                    ...countPipeline,
                    {
                        $sort: {
                            count: -1
                        }
                    },
                    {
                        $limit: limit
                    },
                    {
                        $skip: (page - 1) * limit
                    },
                ]).toArray(),
                db.collection('seancesets').aggregate([
                    ...countPipeline,
                    {
                        $count: "total"
                    }
                ]).toArray()
            ]);

            //search trough Variation to replace the variations ids with the variations docs
            const idsListofLists = variations.map(variation => variation._id);
            const variationIds = idsListofLists.flat();
            const variationsDocs = await Variation.find({ _id: { $in: variationIds } }, { mergedNamesEmbedding: 0 });

            //for each id in _id in variations, replace the id with the variation doc
            const variationsWithDocs = variations.map(variation => {
                const ids = variation._id;
                let variations = [];
                for (const id of ids) {
                    const variationDoc = variationsDocs.find(variationDoc => variationDoc._id.toString() === id.toString());
                    variations.push(variationDoc);
                }
                return {
                    ...variation,
                    variations: variations
                };
            });

            const total = totalResult.length > 0 ? totalResult[0].total : 0;
            return { variations: variationsWithDocs, total };

        });
    } catch (err) {
        console.error("Error fetching my exercices:", err);
        throw err;
    }
}

/**
 * Get the my exercices for a user.
 * @param {string} userId - The ID of the user.
 * @param {number} page - The page number.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercices.
 */
async function getMyExercicesAll(userId, page, limit) {
    try {
        const { MongoClient } = require('mongodb');
        const uri = process.env.mongoURL;
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db(process.env.DATABASE.split('/')[1]);
        const cacheKey = `myExercices_${userId}_${page}_${limit}`;
        return await getOrSetCache(cacheKey, async () => {
            const countPipeline = [
                {
                    $match: {
                        user: new mongoose.Types.ObjectId(userId)
                    }
                },
                {
                    $group: {
                        _id: "$variations.variation",
                        count: { $sum: 1 }
                    }
                }
            ];
            const [variations, totalResult] = await Promise.all([
                db.collection('seancesets').aggregate([
                    ...countPipeline,
                    {
                        $sort: {
                            count: -1
                        }
                    },
                    {
                        $skip: (page - 1) * limit
                    },
                    {
                        $limit: limit
                    }
                ]).toArray(),
                db.collection('seancesets').aggregate([
                    ...countPipeline,
                    {
                        $count: "total"
                    }
                ]).toArray()
            ]);

            //search trough Variation to replace the variations ids with the variations docs
            const idsListofLists = variations.map(variation => variation._id);
            const variationIds = idsListofLists.flat();
            const variationsDocs = await Variation.find({ _id: { $in: variationIds } }, { mergedNamesEmbedding: 0 });

            //for each id in _id in variations, replace the id with the variation doc
            const variationsWithDocs = variations.map(variation => {
                const ids = variation._id;
                let variations = [];
                for (const id of ids) {
                    const variationDoc = variationsDocs.find(variationDoc => variationDoc._id.toString() === id.toString());
                    variations.push(variationDoc);
                }
                return {
                    ...variation,
                    variations: variations
                };
            });

            const total = totalResult.length > 0 ? totalResult[0].total : 0;
            return { variations: variationsWithDocs, total };

        });
    } catch (err) {
        console.error("Error fetching my exercices:", err);
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
        let match = { user: new mongoose.Types.ObjectId(userId) };
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

// PR classification thresholds
const PR_CATEGORIES = {
    repetitions: [
        { max: 3, name: 'Puissance' },
        { max: 6, name: 'Force' },
        { max: 12, name: 'Volume' },
        { max: Infinity, name: 'Endurance' }
    ],
    seconds: [
        { max: 10, name: 'Puissance' },
        { max: 30, name: 'Force' },
        { max: 60, name: 'Volume' },
        { max: Infinity, name: 'Endurance' }
    ]
};

/**
 * Classify a set into a PR category based on its unit and value
 */
function classifySet(unit, value) {
    const thresholds = PR_CATEGORIES[unit];
    if (!thresholds) return null;
    return thresholds.find(t => value <= t.max)?.name || null;
}

/**
 * Get PRs for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} exercice - The ID of the exercice (optional).
 * @param {Array<string>} categories - The array of category JSON strings (optional).
 * @param {string} dateMin - The minimum date (optional).
 * @param {Array<string>} variations - The array of variation IDs (optional).
 * @returns {Promise<Object>} - PRs categorized by Puissance/Force/Volume/Endurance, plus Last.
 */
async function getPRs(userId, exercice, categories, dateMin, variations) {
    try {
        const cacheKey = `prs_${userId}_${exercice || ''}_${JSON.stringify(categories || '')}_${JSON.stringify(variations || '')}_${dateMin || ''}`;

        return await getOrSetCache(cacheKey, async () => {
            // Build query
            const query = { value: { $gt: 0 }, user: new mongoose.Types.ObjectId(userId) };

            if (exercice) {
                query.exercice = new mongoose.Types.ObjectId(exercice);
            }

            if (categories?.length) {
                const categoryIds = categories
                    .map(c => JSON.parse(c))
                    .map(c => new mongoose.Types.ObjectId(c.category));
                query.categories = {
                    $size: categoryIds.length,
                    $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
                };
            }

            if (variations?.length) {
                const variationIds = (Array.isArray(variations) ? variations : [variations])
                    .map(v => new mongoose.Types.ObjectId(v));
                query.variations = {
                    $size: variationIds.length,
                    $all: variationIds.map(id => ({ $elemMatch: { variation: id } }))
                };
            }

            if (dateMin) {
                query.date = { $gte: new Date(dateMin) };
            }

            // Fetch sets sorted by date
            const sets = await Set.find(query).sort({ date: 1 }).exec();

            // Initialize PR result
            const prs = {
                Puissance: { repetitions: null, seconds: null },
                Force: { repetitions: null, seconds: null },
                Volume: { repetitions: null, seconds: null },
                Endurance: { repetitions: null, seconds: null },
                Last: { repetitions: null, seconds: null }
            };

            // Process each set
            for (const set of sets) {
                const category = classifySet(set.unit, set.value);
                if (category && prs[category]) {
                    prs[category][set.unit] = compareAndAssignPR(prs[category][set.unit], set);
                }
            }

            // Get last set for each unit type
            const repSets = sets.filter(s => s.unit === 'repetitions');
            const secSets = sets.filter(s => s.unit === 'seconds');
            prs.Last.repetitions = repSets[repSets.length - 1] || null;
            prs.Last.seconds = secSets[secSets.length - 1] || null;

            return prs;
        });
    } catch (err) {
        console.error("Error fetching PRs:", err);
        throw err;
    }
}

/**
 * Get a summary of personal records for a user's favorite exercices.
 * @param {string} userId - The ID of the user.
 * @param {number} page - The page number for favorite exercices (default: 1).
 * @param {number} limit - The number of favorite exercices to retrieve (default: 10).
 * @param {string} dateMin - The minimum date for PR consideration (optional).
 * @returns {Promise<Object>} - An object containing favorite exercices with their best PRs.
 * {
  summaries: [
    {
      variations: [...],      // Array of variation documents
      variationIds: [...],    // Array of variation IDs
      usageCount: 42,         // Number of times used
      prs: {
        Puissance: { repetitions: {...}, seconds: {...} },
        Force: { repetitions: {...}, seconds: {...} },
        Volume: { repetitions: {...}, seconds: {...} },
        Endurance: { repetitions: {...}, seconds: {...} },
        Best: {...}           // Overall best PR with category & unit
      },
      totalSets: 156          // Total sets recorded for this combination
    }
  ],
  total: 50,                  // Total favorite exercices
  page: 1,
  limit: 10
}
 */
async function getPersonalRecordsSummary(userId, page = 1, limit = 10, dateMin = null) {
    try {
        const cacheKey = `prSummary_${userId}_${page}_${limit}_${dateMin || ''}`;

        return await getOrSetCache(cacheKey, async () => {
            // Step 1: Get user's favorite exercices (variation combinations)
            const { variations: favoriteExercices, total } = await getMyExercicesAll(userId, page, limit);

            // Step 2: For each variation combination, find the best PR
            const summaries = await Promise.all(
                favoriteExercices.map(async (exercice) => {
                    const variationIds = exercice._id; // Array of variation IDs
                    const count = exercice.count; // Number of times this combination was used

                    // Build query for sets with these specific variations
                    const query = {
                        value: { $gt: 0 },
                        user: new mongoose.Types.ObjectId(userId)
                    };

                    // Match exact variation combination
                    if (variationIds?.length) {
                        const variationObjectIds = variationIds.map(v => new mongoose.Types.ObjectId(v));
                        query.variations = {
                            $size: variationObjectIds.length,
                            $all: variationObjectIds.map(id => ({ $elemMatch: { variation: id } }))
                        };
                    }

                    // Apply date filter if provided
                    if (dateMin) {
                        query.date = { $gte: new Date(dateMin) };
                    }

                    // Fetch sets sorted by date
                    const sets = await Set.find(query).sort({ date: 1 }).exec();

                    // Initialize PR categories
                    const prs = {
                        Puissance: { repetitions: null, seconds: null },
                        Force: { repetitions: null, seconds: null },
                        Volume: { repetitions: null, seconds: null },
                        Endurance: { repetitions: null, seconds: null },
                        Best: null // Overall best across all categories
                    };

                    // Process each set to find PRs
                    for (const set of sets) {
                        const category = classifySet(set.unit, set.value);
                        if (category && prs[category]) {
                            prs[category][set.unit] = compareAndAssignPR(prs[category][set.unit], set);
                        }
                    }

                    // Find overall best PR (highest score across all categories)
                    let overallBest = null;
                    let maxScore = -1;

                    let idx = 0;
                    for (const category of ['Endurance', 'Volume', 'Force', 'Puissance']) {
                        for (const unit of ['seconds', 'repetitions']) {
                            const pr = prs[category][unit];
                            if (pr) {
                                const score = idx;
                                if (score > maxScore) {
                                    maxScore = score;
                                    overallBest = { ...pr, category, unit };
                                }
                            }
                            idx++;
                        }
                    }

                    prs.Best = overallBest;

                    return {
                        variations: exercice.variations, // Variation documents
                        variationIds: variationIds, // Array of variation IDs
                        usageCount: count, // Number of times used
                        prs: prs, // PRs by category plus overall best
                        totalSets: sets.length // Total number of sets recorded
                    };
                })
            );

            return {
                summaries,
                total,
                page,
                limit
            };
        });
    } catch (err) {
        console.error("Error fetching personal records summary:", err);
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

    if (value === 0) return null; // Ignore sets with 0 reps

    // Call the API to check if this set is a personal record
    try {
        // Check if this is the first time recording this exercise
        const allSets = await getSets(
            userId,           // userId
            seanceId,         // excludedSeanceId
            null,             // seanceId
            null,             // exercice
            null,             // categories
            unit,             // unit
            null,             // value
            null,             // weightLoad
            null,             // elasticTension
            null,             // dateMin
            null,             // dateMax
            null,             // fields
            variations        // variations
        );
        if (allSets.length === 0) {
            return "NB"; // New Best - first time recording this exercise
        }

        // Filter sets that are better or equal to the current set, when unit is the same
        let sets = allSets.filter(s => {
            if (unit && s.unit !== unit) return false;

            // ALL applicable attributes must be better or equal (AND logic, not OR)
            let isBetterOrEqual = true;

            // Check value - if current has value, previous must be >= 
            if (value != null && (s.value == null || s.value < value)) isBetterOrEqual = false;

            // Check weightLoad - if current has weightLoad, previous must be >=
            if (weightLoad != null && (s.weightLoad == null || s.weightLoad < weightLoad)) isBetterOrEqual = false;

            // Check elastic tension
            if (elastic && elastic.use && elastic.tension != null) {
                if (!s.elastic || !s.elastic.use || s.elastic.use !== elastic.use) {
                    isBetterOrEqual = false;
                } else {
                    if (elastic.use === "resistance" && s.elastic.tension < elastic.tension) isBetterOrEqual = false;
                    if (elastic.use === "assistance" && s.elastic.tension > elastic.tension) isBetterOrEqual = false;
                }
            }

            return isBetterOrEqual;
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
            if (value != null && bestSet.value != null && bestSet.value > value) isBestSet = false;
            if (weightLoad != null && bestSet.weightLoad != null && bestSet.weightLoad > weightLoad) isBestSet = false;
            if (elastic && elastic.use && elastic.tension != null) {
                if (elastic.use === "resistance" && bestSet.elastic && bestSet.elastic.tension > elastic.tension) isBestSet = false;
                if (elastic.use === "assistance" && bestSet.elastic && bestSet.elastic.tension < elastic.tension) isBestSet = false;
            }

            if (isBestSet === true) {
                return "SB";
            }
        }

        return null; // Not a PR


    } catch (error) {
        console.error('Error checking for personal record:', error);
        return null; // Handle errors by returning false (not a PR)
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
module.exports = { getSets, getTopExercices, createSet, getPRs, getLastFormats, deleteSets, isPersonalRecord, getMyExercicesSearch, getMyExercicesAll, getPersonalRecordsSummary };

