const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();
const { compareAndAssignPR, getEffectiveLoad, getEffectiveLoadPreferringPersisted } = require('../utils/set');
const { mergePersistedOptionalFieldsFromClient, KG_TO_LB, round2 } = require('../utils/seanceSetPersistedFields');
const { normalizeString } = require('../utils/string');
const Variation = require('../schema/variation');

function getSortedVariationIds(variationIds = []) {
    return variationIds.map(id => id.toString()).sort();
}

function getVariationSignature(variationIds = []) {
    return getSortedVariationIds(variationIds).join('|');
}

async function getAlternativeVariationGroups(variationIds = []) {
    const baseIds = getSortedVariationIds(variationIds);
    const uniqueGroups = new Map();

    if (baseIds.length === 0) {
        return [];
    }

    uniqueGroups.set(getVariationSignature(baseIds), baseIds);

    const baseObjectIds = baseIds.map(id => new mongoose.Types.ObjectId(id));

    // Multi-variations input: only map to verified singleton variations whose
    // equivalentTo matches the full set exactly.
    const equivalentVerifiedVariations = await Variation.find(
        {
            verified: true,
            equivalentTo: {
                $size: baseIds.length,
                $all: baseObjectIds
            }
        },
        { _id: 1 }
    );

    for (const variation of equivalentVerifiedVariations) {
        const verifiedSingleton = [variation._id.toString()];
        uniqueGroups.set(getVariationSignature(verifiedSingleton), verifiedSingleton);
    }

    // Singleton input: if it is a verified canonical variation, also include
    // its equivalentTo full group for backward-compatible retrieval.
    if (baseIds.length === 1) {
        const canonicalVariation = await Variation.findOne(
            {
                _id: new mongoose.Types.ObjectId(baseIds[0]),
                verified: true
            },
            { equivalentTo: 1 }
        );

        if (canonicalVariation?.equivalentTo?.length) {
            const equivalentGroup = getSortedVariationIds(canonicalVariation.equivalentTo);
            uniqueGroups.set(getVariationSignature(equivalentGroup), equivalentGroup);
        }
    }

    return Array.from(uniqueGroups.values());
}

function buildVariationsExactMatchQuery(variationGroups = []) {
    const groups = variationGroups.filter(group => Array.isArray(group) && group.length > 0);

    if (groups.length === 0) {
        return null;
    }

    const conditions = groups.map(group => ({
        variations: {
            $size: group.length,
            $all: group.map(id => ({ $elemMatch: { variation: new mongoose.Types.ObjectId(id) } }))
        }
    }));

    if (conditions.length === 1) {
        return conditions[0];
    }

    return { $or: conditions };
}

async function getEquivalentVerifiedMapFromGroups(variationGroups = []) {
    const uniqueGroupsBySignature = new Map();

    for (const group of variationGroups) {
        const sortedIds = getSortedVariationIds(group);
        if (sortedIds.length === 0) continue;
        const signature = sortedIds.join('|');
        if (!uniqueGroupsBySignature.has(signature)) {
            uniqueGroupsBySignature.set(signature, sortedIds);
        }
    }

    if (uniqueGroupsBySignature.size === 0) {
        return new Map();
    }

    const equivalentConditions = Array.from(uniqueGroupsBySignature.values()).map(sortedIds => ({
        equivalentTo: {
            $size: sortedIds.length,
            $all: sortedIds.map(id => new mongoose.Types.ObjectId(id))
        }
    }));

    const equivalentVariations = await Variation.find(
        {
            verified: true,
            $or: equivalentConditions
        },
        { mergedNamesEmbedding: 0 }
    ).sort({ popularity: -1, createdAt: 1 });

    const equivalentBySignature = new Map();

    for (const equivalentVariation of equivalentVariations) {
        const signature = getVariationSignature(equivalentVariation.equivalentTo || []);
        if (!equivalentBySignature.has(signature)) {
            equivalentBySignature.set(signature, equivalentVariation);
        }
    }

    return equivalentBySignature;
}

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
            let categoriesJson = categories.map(c => JSON.parse(c));
            if (!Array.isArray(categoriesJson)) {
                categoriesJson = [categoriesJson];
            }

            const categoryIds = categoriesJson.map(c => new mongoose.Types.ObjectId(c.category));

            query.categories = {
                $size: categoryIds.length,
                $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
            };
        }
        if (variations) {
            let variationsJson;

            if (typeof variations[0] === 'string') {
                variationsJson = variations.map(v => JSON.parse(v));
            } else {
                variationsJson = variations;
            }

            if (!Array.isArray(variationsJson)) {
                variationsJson = [variationsJson];
            }

            const variationIds = variationsJson.map(v => v.variation);
            const variationGroups = await getAlternativeVariationGroups(variationIds);
            const variationQuery = buildVariationsExactMatchQuery(variationGroups);

            if (variationQuery?.$or) {
                query.$or = variationQuery.$or;
            } else if (variationQuery?.variations) {
                query.variations = variationQuery.variations;
            }
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
                date: 1,
                exerciceOrder: 1,
                setOrder: 1
            })
            .exec();
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
 * @param {string} seanceName - Optional seance name to filter by
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top exercises.
 */
async function getTopExercices(userId, by, asc, page = 1, limit = 3, seanceName = null) {
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

        const agg = [
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
            //TODO: Change by variations
            { $group: { _id: ['$exercice', '$categories.category'], total: { $sum: groupBy }, seances: { $addToSet: "$seance" } } },
            {
                $addFields: {
                    seancesSize: { $size: "$seances" }
                }
            },
            {
                '$project': {
                    exercice: { '$arrayElemAt': ['$_id', 0] },
                    categories: { '$arrayElemAt': ['$_id', 1] },
                    total: 1,
                    seancesSize: 1,
                    _id: 0
                }
            },
            { $sort: { [totalField]: sort, exercice: 1, categories: 1 } },
        ];

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
        const { MongoClient, ObjectId } = require('mongodb');
        const uri = process.env.mongoURL;
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db(process.env.DATABASE.split('/')[1]);
        const normalizedSearch = normalizeString(search);

        const userIdObjectId = ObjectId.isValid(userId)
            ? new ObjectId(userId)
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

        const idsListofLists = variations.map(variation => variation._id.map(id => id.toString()));
        const variationIds = idsListofLists.flat();
        const variationsDocs = await Variation.find({ _id: { $in: variationIds } }, { mergedNamesEmbedding: 0 });
        const equivalentVerifiedBySignature = await getEquivalentVerifiedMapFromGroups(idsListofLists);

        const variationsWithDocs = variations.map(variation => {
            const ids = variation._id.map(id => id.toString());
            const signature = getVariationSignature(ids);
            const equivalentVariation = equivalentVerifiedBySignature.get(signature);

            if (equivalentVariation) {
                return {
                    ...variation,
                    _id: [equivalentVariation._id.toString()],
                    variations: [equivalentVariation]
                };
            }

            let variationsList = [];
            for (const id of ids) {
                const variationDoc = variationsDocs.find(variationDoc => variationDoc._id.toString() === id.toString());
                variationsList.push(variationDoc);
            }
            return {
                ...variation,
                _id: ids,
                variations: variationsList
            };
        });

        const total = totalResult.length > 0 ? totalResult[0].total : 0;
        return { variations: variationsWithDocs, total };
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
        const { MongoClient, ObjectId } = require('mongodb');
        const uri = process.env.mongoURL;
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db(process.env.DATABASE.split('/')[1]);
        const countPipeline = [
            {
                $match: {
                    user: new ObjectId(userId)
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

        const idsListofLists = variations.map(variation => variation._id.map(id => id.toString()));
        const variationIds = idsListofLists.flat();
        const variationsDocs = await Variation.find({ _id: { $in: variationIds } }, { mergedNamesEmbedding: 0 });
        const equivalentVerifiedBySignature = await getEquivalentVerifiedMapFromGroups(idsListofLists);

        const variationsWithDocs = variations.map(variation => {
            const ids = variation._id.map(id => id.toString());
            const signature = getVariationSignature(ids);
            const equivalentVariation = equivalentVerifiedBySignature.get(signature);

            if (equivalentVariation) {
                return {
                    ...variation,
                    _id: [equivalentVariation._id.toString()],
                    variations: [equivalentVariation]
                };
            }

            let variationsList = [];
            for (const id of ids) {
                const variationDoc = variationsDocs.find(variationDoc => variationDoc._id.toString() === id.toString());
                variationsList.push(variationDoc);
            }
            return {
                ...variation,
                _id: ids,
                variations: variationsList
            };
        });

        const total = totalResult.length > 0 ? totalResult[0].total : 0;
        return { variations: variationsWithDocs, total };
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
        let match = { user: new mongoose.Types.ObjectId(userId) };
        if (exercice) {
            match.exercice = new mongoose.Types.ObjectId(exercice);
        }
        if (categories) {
            match.categories = { $size: categories.length, $all: categories.map(c => ({ $elemMatch: { category: new mongoose.Types.ObjectId(c) } })) };
        }

        const agg = [
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
                    "sets.brzycki": 1,
                    "sets.epley": 1,
                    "sets.effectiveWeightLoad": 1,
                    "sets.weightLoadLbs": 1,
                    "sets.effectiveWeightLoadLbs": 1,
                    date: 1
                }
            },
            {
                $sort: {
                    date: -1
                }
            }
        ];

        const countPipeline = [...agg, { $count: 'total' }];
        const [countResult] = await Set.aggregate(countPipeline).exec();
        const total = countResult?.total || 0;

        const dataPipeline = [...agg,
        { $skip: (page - 1) * limit },
        { $limit: limit }
        ];
        const lastFormats = await Set.aggregate(dataPipeline).exec();

        return { lastFormats: lastFormats, total };
    } catch (err) {
        console.error("Error fetching last formats:", err);
        throw err;
    }
}

// PR classification thresholds
const PR_CATEGORIES = {
    repetitions: [
        { min: 0, max: 3, name: 'Puissance' },
        { min: 3, max: 6, name: 'Force' },
        { min: 6, max: 12, name: 'Volume' },
        { min: 12, max: Infinity, name: 'Endurance' }
    ],
    seconds: [
        { min: 0, max: 10, name: 'Puissance' },
        { min: 10, max: 30, name: 'Force' },
        { min: 30, max: 60, name: 'Volume' },
        { min: 60, max: Infinity, name: 'Endurance' }
    ]
};

/**
 * Classify a set into one or multiple PR categories based on its unit and value.
 * Boundaries are inclusive (e.g. 3 reps is both Puissance and Force).
 */
function classifySet(unit, value) {
    const thresholds = PR_CATEGORIES[unit];
    if (!thresholds || value == null) return [];
    return thresholds
        .filter(t => value >= t.min && value <= t.max)
        .map(t => t.name);
}

async function fetchSetsForPR(userId, excludedSeanceId, exercice, categories, dateMin, variations) {
    const query = { value: { $gt: 0 }, user: new mongoose.Types.ObjectId(userId) };

    if (excludedSeanceId) {
        query.seance = { $ne: new mongoose.Types.ObjectId(excludedSeanceId) };
    }

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
            .map(v => v.toString());
        const variationGroups = await getAlternativeVariationGroups(variationIds);
        const variationQuery = buildVariationsExactMatchQuery(variationGroups);

        if (variationQuery?.$or) {
            query.$or = variationQuery.$or;
        } else if (variationQuery?.variations) {
            query.variations = variationQuery.variations;
        }
    }

    if (dateMin) {
        query.date = { $gte: new Date(dateMin) };
    }

    return Set.find(query).sort({ date: 1 }).exec();
}

/**
 * Get PRs for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} excludedSeanceId - The seance ID to exclude from PR computation (optional).
 * @param {string} exercice - The ID of the exercice (optional).
 * @param {Array<string>} categories - The array of category JSON strings (optional).
 * @param {string} dateMin - The minimum date (optional).
 * @param {Array<string>} variations - The array of variation IDs (optional).
 * @returns {Promise<Object>} - PRs categorized by Puissance/Force/Volume/Endurance, plus Last.
 */
async function getPRs(userId, excludedSeanceId, exercice, categories, dateMin, variations) {
    try {
        const sets = await fetchSetsForPR(userId, excludedSeanceId, exercice, categories, dateMin, variations);

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
            const categoriesForSet = classifySet(set.unit, set.value);
            for (const category of categoriesForSet) {
                if (prs[category]) {
                    prs[category][set.unit] = compareAndAssignPR(prs[category][set.unit], set);
                }
            }
        }

        // Get last set for each unit type
        const repSets = sets.filter(s => s.unit === 'repetitions');
        const secSets = sets.filter(s => s.unit === 'seconds');
        prs.Last.repetitions = repSets[repSets.length - 1] || null;
        prs.Last.seconds = secSets[secSets.length - 1] || null;

        return prs;
    } catch (err) {
        console.error("Error fetching PRs:", err);
        throw err;
    }
}

/**
 * PRs par nombre de reps / secondes (nRM), sans regroupement par catégorie physiologique.
 * Chaque clé `"nRM"` contient le meilleur set pour `repetitions` et pour `seconds` à cette valeur n (arrondi par le bas).
 * @returns {Promise<Object>} - { "1RM": { repetitions, seconds }, "2RM": {...}, ..., Last: { repetitions, seconds } }
 */
async function getDetailedPRs(userId, exercice, categories, dateMin, variations) {
    try {
        const sets = await fetchSetsForPR(userId, exercice, categories, dateMin, variations);

        const prs = {
            Last: { repetitions: null, seconds: null }
        };

        for (const set of sets) {
            if (set.unit !== 'repetitions' && set.unit !== 'seconds') continue;

            const n = Math.floor(set.value);
            if (n < 1) continue;

            const rmKey = `${n}RM`;
            if (!prs[rmKey]) {
                prs[rmKey] = { repetitions: null, seconds: null };
            }
            prs[rmKey][set.unit] = compareAndAssignPR(prs[rmKey][set.unit], set);
        }

        const repSets = sets.filter(s => s.unit === 'repetitions');
        const secSets = sets.filter(s => s.unit === 'seconds');
        prs.Last.repetitions = repSets[repSets.length - 1] || null;
        prs.Last.seconds = secSets[secSets.length - 1] || null;

        return prs;
    } catch (err) {
        console.error("Error fetching detailed PRs:", err);
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
                        const variationGroups = await getAlternativeVariationGroups(variationIds);
                        const variationQuery = buildVariationsExactMatchQuery(variationGroups);

                        if (variationQuery?.$or) {
                            query.$or = variationQuery.$or;
                        } else if (variationQuery?.variations) {
                            query.variations = variationQuery.variations;
                        }
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
                        const categoriesForSet = classifySet(set.unit, set.value);
                        for (const category of categoriesForSet) {
                            if (prs[category]) {
                                prs[category][set.unit] = compareAndAssignPR(prs[category][set.unit], set);
                            }
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
 * @param {number|undefined|null} effectiveWeightLoadOverride — charge effective (kg) envoyée par l’app ; si défini et fini, utilisé à la place de weightLoad + élastique
 * @returns {string} "PR" if it is a personal record, "SB" if it is the same best, "NB" if it is the first time recording this exercise, null if it is not a personal record
 */
async function isPersonalRecord(userId, seanceId, unit, value, weightLoad, elastic, variations, effectiveWeightLoadOverride) {
    const { isPersonalRecord } = await evaluatePersonalRecordWithContext(
        userId,
        seanceId,
        unit,
        value,
        weightLoad,
        elastic,
        variations,
        effectiveWeightLoadOverride
    );
    return isPersonalRecord;
};

async function fetchPersonalRecordCandidateSets(userId, seanceId, unit, variations) {
    const query = {};
    if (userId) {
        query.user = new mongoose.Types.ObjectId(userId);
    }
    if (seanceId) {
        query.seance = { $ne: new mongoose.Types.ObjectId(seanceId) };
    }
    if (unit) {
        query.unit = unit;
    }
    if (variations) {
        const variationIds = (Array.isArray(variations) ? variations : [variations]).map(v =>
            typeof v === 'object' && v !== null ? v.variation?.toString() : v?.toString()
        ).filter(Boolean);
        const variationGroups = await getAlternativeVariationGroups(variationIds);
        const variationQuery = buildVariationsExactMatchQuery(variationGroups);
        if (variationQuery?.$or) {
            query.$or = variationQuery.$or;
        } else if (variationQuery?.variations) {
            query.variations = variationQuery.variations;
        }
    }

    return Set.find(query)
        .select("unit value weightLoad elastic effectiveWeightLoad weightLoadLbs effectiveWeightLoadLbs date seance variations")
        .lean()
        .exec();
}

async function evaluatePersonalRecordWithContext(userId, seanceId, unit, value, weightLoad, elastic, variations, effectiveWeightLoadOverride) {

    if (value === 0) {
        return { isPersonalRecord: null, prDetail: null }; // Ignore sets with 0 reps
    }
    const currentEffectiveLoad =
        effectiveWeightLoadOverride !== undefined &&
        effectiveWeightLoadOverride !== null &&
        Number.isFinite(Number(effectiveWeightLoadOverride))
            ? Number(effectiveWeightLoadOverride)
            : getEffectiveLoad({ weightLoad, elastic });
    const currentEffectiveLoadLbs = round2(currentEffectiveLoad * KG_TO_LB);

    // Call the API to check if this set is a personal record
    try {
        // Check if this is the first time recording this exercise
        const allSets = await fetchPersonalRecordCandidateSets(userId, seanceId, unit, variations);

        if (allSets.length === 0) {
            return {
                isPersonalRecord: "NB",
                prDetail: {
                    valueDelta: null,
                    repsDelta: null,
                    secondsDelta: null,
                    kgDelta: null,
                    lbsDelta: null,
                    effectiveLoadCurrent: round2(currentEffectiveLoad),
                    effectiveLoadReference: null,
                    effectiveLoadCurrentLbs: currentEffectiveLoadLbs,
                    effectiveLoadReferenceLbs: null,
                    referenceBestSet: null
                }
            };
        }

        // Filter sets that are better or equal to the current set, when unit is the same
        let sets = allSets.filter(s => {
            if (unit && s.unit !== unit) return false;

            // ALL applicable attributes must be better or equal (AND logic, not OR)
            let isBetterOrEqual = true;

            // Check value - if current has value, previous must be >= 
            if (value != null && (s.value == null || s.value < value)) isBetterOrEqual = false;

            // Compare effective load (persisted kg ou weightLoad + élastique)
            if (s.weightLoad == null || getEffectiveLoadPreferringPersisted(s) < currentEffectiveLoad) isBetterOrEqual = false;

            return isBetterOrEqual;
        });

        // Check if the set is a personal record
        let status = null;
        if (sets.length === 0) {
            status = "PR";
        } else {
            // Find the best set from sets (highest value, then highest effective load)
            const bestSet = sets.reduce((best, current) => {
                if (current.value > best.value) return current;
                if (current.value === best.value && getEffectiveLoadPreferringPersisted(current) > getEffectiveLoadPreferringPersisted(best)) return current;
                return best;
            });

            // Check if the current set is the best set using values
            let isBestSet = true;
            if (value != null && bestSet.value != null && bestSet.value > value) isBestSet = false;
            if (getEffectiveLoadPreferringPersisted(bestSet) > currentEffectiveLoad) isBestSet = false;

            if (isBestSet === true) {
                status = "SB";
            }
        }

        const referenceBestSet = getReferenceBestSet(allSets, value, currentEffectiveLoad);
        const referenceEffectiveLoad = referenceBestSet ? getEffectiveLoadPreferringPersisted(referenceBestSet) : null;
        const referenceEffectiveLoadLbs = referenceBestSet ? getEffectiveLoadLbsPreferringPersisted(referenceBestSet) : null;
        const valueDelta = referenceBestSet && value != null && referenceBestSet.value != null
            ? value - referenceBestSet.value
            : null;
        const kgDelta = referenceBestSet && referenceEffectiveLoad != null
            ? round2(currentEffectiveLoad - referenceEffectiveLoad)
            : null;
        const lbsDelta = referenceBestSet && referenceEffectiveLoadLbs != null
            ? round2(currentEffectiveLoadLbs - referenceEffectiveLoadLbs)
            : null;

        return {
            isPersonalRecord: status,
            prDetail: {
                valueDelta,
                repsDelta: unit === 'repetitions' ? valueDelta : null,
                secondsDelta: unit === 'seconds' ? valueDelta : null,
                kgDelta,
                lbsDelta,
                effectiveLoadCurrent: round2(currentEffectiveLoad),
                effectiveLoadReference: referenceEffectiveLoad != null ? round2(referenceEffectiveLoad) : null,
                effectiveLoadCurrentLbs: currentEffectiveLoadLbs,
                effectiveLoadReferenceLbs: referenceEffectiveLoadLbs,
                referenceBestSet
            }
        };


    } catch (error) {
        console.error('Error checking for personal record:', error);
        return { isPersonalRecord: null, prDetail: null };
    }
}

function getEffectiveLoadLbsPreferringPersisted(set) {
    const persistedLbs = set?.effectiveWeightLoadLbs;
    if (persistedLbs != null && Number.isFinite(Number(persistedLbs))) {
        return Number(persistedLbs);
    }
    const persistedKg = set?.effectiveWeightLoad;
    if (persistedKg != null && Number.isFinite(Number(persistedKg))) {
        return round2(Number(persistedKg) * KG_TO_LB);
    }
    const weightLoadLbs = set?.weightLoadLbs;
    if (weightLoadLbs != null && Number.isFinite(Number(weightLoadLbs))) {
        return Number(weightLoadLbs);
    }
    return round2(getEffectiveLoad(set) * KG_TO_LB);
}

function getReferenceBestSet(sets, currentValue, currentEffectiveLoad) {
    if (!sets.length) return null;
    const targetValue = Number.isFinite(Number(currentValue)) ? Number(currentValue) : 0;
    const targetLoad = Number.isFinite(Number(currentEffectiveLoad)) ? Number(currentEffectiveLoad) : 0;

    return sets.reduce((best, current) => {
        if (!best) return current;

        const bestValue = Number(best?.value ?? 0);
        const currentSetValue = Number(current?.value ?? 0);
        const bestLoad = getEffectiveLoadPreferringPersisted(best);
        const currentSetLoad = getEffectiveLoadPreferringPersisted(current);

        const bestDistance = Math.abs(targetValue - bestValue) + Math.abs(targetLoad - bestLoad);
        const currentDistance = Math.abs(targetValue - currentSetValue) + Math.abs(targetLoad - currentSetLoad);

        if (currentDistance < bestDistance) return current;
        if (currentDistance > bestDistance) return best;

        // Tie-break: prefer a "base" set not above current (gains non-négatifs si possible).
        const bestIsBase = bestValue <= targetValue && bestLoad <= targetLoad;
        const currentIsBase = currentSetValue <= targetValue && currentSetLoad <= targetLoad;
        if (currentIsBase && !bestIsBase) return current;
        if (!currentIsBase && bestIsBase) return best;

        // Final tie-break: keep the strongest nearby reference.
        if (currentSetValue > bestValue) return current;
        if (currentSetValue < bestValue) return best;
        if (currentSetLoad > bestLoad) return current;
        return best;
    }, null);
}

/**
 * Version enrichie de l'évaluation PR: conserve le statut et ajoute les deltas
 * vs meilleur set historique strict (mêmes variations + même unit).
 */
async function isPersonalRecordWithDetail(userId, seanceId, unit, value, weightLoad, elastic, variations, effectiveWeightLoadOverride) {
    return evaluatePersonalRecordWithContext(
        userId,
        seanceId,
        unit,
        value,
        weightLoad,
        elastic,
        variations,
        effectiveWeightLoadOverride
    );
}



/**
 * Create a new set.
 * @param {Object} setData - The set data.
 * @returns {Promise<Object>} - A promise that resolves to the new set object.
 */
async function createSet(setData) {
    try {
        const payload = mergePersistedOptionalFieldsFromClient(setData);
        const newSet = await Set.create(payload);
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
    } catch (err) {
        console.error("Error deleting sets:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getSets, getTopExercices, createSet, getPRs, getDetailedPRs, getLastFormats, deleteSets, isPersonalRecord, isPersonalRecordWithDetail, getMyExercicesSearch, getMyExercicesAll, getPersonalRecordsSummary };

