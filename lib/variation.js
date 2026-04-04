const Variation = require('../schema/variation');
const { normalizeString, generateTokenCombinations, generateEmbedding, vectorSimilarity } = require('../utils/string');
const mongoose = require('mongoose');
const SeanceSet = require('../schema/seanceset');
const { isFalsy } = require('liquidjs');
const set = require('./set');

const lookup_type = [
    {
        $lookup: {
            from: 'types',
            localField: 'type',
            foreignField: '_id',
            as: 'typeInfo'
        }
    },
    { $unwind: '$typeInfo' },
]

/**
 * Using atlas search autocomplete, retrieve variations from the database
 * @param {String} search - The search query
 * @param {String} type - The type of variation to search for
 * @param {String} sortBy - The field to sort by
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @param {Boolean} verified - Filter by verified status
 * @returns {Object} - The variations and the total number of variations
 */
const getVariationBySearch = async (search, type, sortBy, page, limit, verified, isExercice, myExercices, userId) => {
    if (myExercices && userId && search) {
        console.log("searching for my exercices");
        return set.getMyExercicesSearch(userId, search, page, limit);
    }

    let sortField = 'name.fr';
    let sortOrder = 1;
    if (sortBy === 'name') {
        sortField = 'name.fr';
        sortOrder = 1;
    } else if (sortBy === 'type') {
        sortBy = 'typeInfo.popularityScore';
    } else {
        sortBy = 'name.fr';
    }

    // new sortBy
    if (sortBy === 'popularity') {
        sortField = 'popularity';
        sortOrder = -1;
    } else if (sortBy === 'name.fr') {
        sortField = 'name.fr';
        sortOrder = 1;
    } else if (sortBy === 'name.en') {
        sortField = 'name.en';
        sortOrder = 1;
    } else {
        sortField = 'name.fr';
        sortOrder = 1;
    }

    const normalizedSearch = normalizeString(search);
    const compound = {
            should: [
                {
                    autocomplete: {
                        query: normalizedSearch,
                        path: "name.fr",
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
                        path: "name.fr",
                        score: { boost: { value: 3 } },
                        // synonyms: "synonyms"
                    }
                },
                {
                    autocomplete: {
                        query: normalizedSearch,
                        path: "name.en",
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
                        path: "name.en",
                        // synonyms: "synonyms",
                        score: { boost: { value: 3 } }
                    }
                }
            ]
        }

        const filters = [];
        if (type) {
            filters.push({
                equals: {
                    value: new mongoose.Types.ObjectId(type),
                    path: "type"
                }
            });
        }
        if (verified !== undefined) {
            filters.push({
                equals: {
                    value: verified,
                    path: "verified"
                }
            });
        }
        if (isExercice !== undefined) {
            filters.push({
                equals: {
                    value: isExercice,
                    path: "isExercice"
                }
            });
        }

        if (filters.length > 0) {
            compound.filter = filters;
            compound.minimumShouldMatch = 1;
        }

        const [variations, totalResult] = await Promise.all([
            Variation.aggregate([
                {
                    $search: {
                        index: "variations",
                        compound: compound
                    }
                },
                {
                    $skip: (page - 1) * limit
                },
                {
                    $limit: limit
                },
                { $sort: { [sortField]: sortOrder } },
                ...lookup_type,
            ]),
            Variation.aggregate([
                {
                    $search: {
                        index: "variations",
                        compound: compound
                    }
                },
                {
                    $count: "total"
                }
            ])
        ]);

    const total = totalResult.length > 0 ? totalResult[0].total : 0;
    return { variations, total };
};

/**
 * Get variations sorted by frequency for a specific user
 * @param {Object} query - The query to filter variations
 * @param {String} userId - The user ID
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @returns {Object} - The variations and the total number of variations
 */
const _getVariationsByFrequency = async (query, userId, page, limit) => {
    // Get variation frequencies for this user
    const variationFrequencies = await SeanceSet.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        { $unwind: '$variations' },
        {
            $group: {
                _id: '$variations.variation',
                frequency: { $sum: 1 }
            }
        }
    ]);

    // Create a map for quick lookup
    const frequencyMap = {};
    variationFrequencies.forEach(item => {
        frequencyMap[item._id.toString()] = item.frequency;
    });

    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            { $match: query },
            ...lookup_type,
        ]),
        Variation.countDocuments(query)
    ]);

    // Inject frequency after aggregation
    const variationsWithFrequency = variations.map(variation => ({
        ...variation,
        frequency: frequencyMap[variation._id.toString()] || 0
    }));

    // Sort manually
    variationsWithFrequency.sort((a, b) => b.frequency - a.frequency);

    // Apply pagination after sorting
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedVariations = variationsWithFrequency.slice(startIndex, endIndex);

    return { variations: paginatedVariations, total: totalResult };
};

/**
 * Get variations sorted by last used date for a specific user
 * @param {Object} query - The query to filter variations
 * @param {String} userId - The user ID
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @returns {Object} - The variations and the total number of variations
 */
const _getVariationsByLastUsed = async (query, userId, page, limit) => {
    // Get variation last used dates for this user
    const variationLastUsed = await SeanceSet.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        { $unwind: '$variations' },
        {
            $group: {
                _id: '$variations.variation',
                lastUsed: { $max: '$date' }
            }
        }
    ]);

    // Create a map for quick lookup
    const lastUsedMap = {};
    variationLastUsed.forEach(item => {
        lastUsedMap[item._id.toString()] = item.lastUsed;
    });

    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            { $match: query },
            ...lookup_type,
        ]),
        Variation.countDocuments(query)
    ]);

    // Inject lastUsed date after aggregation
    const variationsWithLastUsed = variations.map(variation => ({
        ...variation,
        lastUsed: lastUsedMap[variation._id.toString()] || null
    }));

    // Sort manually - most recent first, then variations never used
    variationsWithLastUsed.sort((a, b) => {
        if (!a.lastUsed && !b.lastUsed) return 0;
        if (!a.lastUsed) return 1;
        if (!b.lastUsed) return -1;
        return new Date(b.lastUsed) - new Date(a.lastUsed);
    });

    // Apply pagination after sorting
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedVariations = variationsWithLastUsed.slice(startIndex, endIndex);

    return { variations: paginatedVariations, total: totalResult };
};

/**
 * Get variations with default sorting (popularity score and name)
 * @param {Object} query - The query to filter variations
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @returns {Object} - The variations and the total number of variations
 */
const _getVariationsByPopularity = async (query, page, limit) => {
    const sortStage = { 'popularity': -1, 'typeInfo.popularityScore': -1 };

    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            { $match: query },
            ...lookup_type,
            { $sort: sortStage },
            { $skip: (page - 1) * limit },
            { $limit: limit }
        ]),
        Variation.countDocuments(query)
    ]);
    return { variations, total: totalResult };
};

/**
* Get variations by name
 * @param {Object} query - The query to filter variations
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @param {String} sortBy - The field to sort by
 * @returns {Object} - The variations and the total number of variations
 */
const _getVariationsByName = async (query, page, limit, sortBy) => {
    if (sortBy === 'name.en') {
        sortStage = { 'name.en': 1 };
    }
    else if (sortBy === 'name.fr') {
        sortStage = { 'name.fr': 1 };
    }
    else {
        sortStage = { 'name.en': 1 };
    }

    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            { $match: query },
            ...lookup_type,
            { $sort: sortStage },
            { $skip: (page - 1) * limit },
            { $limit: limit }
        ]),
        Variation.countDocuments(query)
    ]);
    return { variations, total: totalResult };
};

/**
 * Get all variations from the database
 * @param {String} type - The type of variation to search for
 * @param {String} sortBy - The field to sort by
 * @param {String} userId - The user ID for frequency-based sorting
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @param {Boolean} verified - Filter by verified status
 * @param {Boolean} myExercices - Filter by my exercices
 * @returns {Object} - The variations and the total number of variations
 */
const getAllVariations = async (type, sortBy, userId, page = 1, limit = 20, verified, isExercice, myExercices) => {
    try {
        if (myExercices && userId) {
                return await set.getMyExercicesAll(userId, page, limit);
            }

            const query = {};
            if (type) {
                query.type = new mongoose.Types.ObjectId(type);
            }
            if (verified !== undefined) {
                query.verified = verified;
            }
            if (isExercice !== undefined) {
                query.isExercice = isExercice;
            }
        if (sortBy === 'frequency' && userId) {
            return await _getVariationsByFrequency(query, userId, page, limit);
        } else if (sortBy === 'lastUsed' && userId) {
            return await _getVariationsByLastUsed(query, userId, page, limit);
        } else if (sortBy === 'popularity') {
            return await _getVariationsByPopularity(query, page, limit);
        } else {
            return await _getVariationsByName(query, page, limit, sortBy);
        }
    } catch (err) {
        console.error("Error fetching variations:", err);
        throw err;
    }
};

/**
 * Get variations by AI with token combinations
 * @param {String} search - The search query
 * @returns {Object} - The variations
 */
const getVariationByAI = async (search) => {
    // 1 - generate token combinations
    const tokenCombinations = generateTokenCombinations(search);
    console.log("tokenCombinations", tokenCombinations);

    // 2 - search for each combination and collect results
    const allResults = [];

    for (const combination of tokenCombinations) {
        const topVariationsForCombination = await Promise.all(combination.map(async (token, index) => {
            const enrichedSearch = "Exercise or detail corresponding or similar to " + token + " in English or French";
            const queryEmbedding = await generateEmbedding(enrichedSearch);
            if (queryEmbedding) {
                const pipeline = createRRFPipeline(token, queryEmbedding);
                const variations = await Variation.aggregate(pipeline);
                const topVariation = variations.sort((a, b) => b.score - a.score)[0];
                return topVariation;
            }
            console.warn('Failed to generate embedding, falling back to regular search');
            let { variations } = await getVariationBySearch(token, null, null, 1, 7);
            return { ...variations[0], score: 1 };
        }));

        console.log("topVariationsForCombination", topVariationsForCombination);

        // 3 - Calculate similarity score
        let similarityScore = 0;
        if (topVariationsForCombination.length > 0) {
            const variationNames = topVariationsForCombination.map(v => v.name || {}).filter(name => name);

            if (variationNames.length > 0) {
                const frNames = variationNames.map(v => v.fr || '').filter(name => name).join(', ');
                const enNames = variationNames.map(v => v.en || '').filter(name => name).join(', ');

                const [frSimilarity, enSimilarity] = await Promise.all([
                    vectorSimilarity(search, frNames),
                    vectorSimilarity(search, enNames)
                ]);

                similarityScore = (frSimilarity + enSimilarity) / 2;
            }
        }

        // 4 - Calculate final score for this combination
        const sumScore = topVariationsForCombination.reduce((sum, variation) => sum + (variation.score || 0), 0);
        const oneExerciceBool = topVariationsForCombination.some(v => v && v.isExercice === true);
        const finalScore = sumScore / combination.length + similarityScore + (oneExerciceBool ? 0.5 : 0);

        allResults.push({
            variations: topVariationsForCombination,
            tokens: combination,
            sumScore,
            finalScore,
            similarityScore
        });
    }

    console.log("allResults", allResults);

    // 5 - Sort by final score + similarity score and return the best one
    const bestResults = allResults.sort((a, b) => b.finalScore - a.finalScore);

    return bestResults.slice(0, 3);
};

/**
 * Create the RRF pipeline for combining vector search and full-text search
 * @param {string} queryText - Search query text
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {Object} options - Search options
 * @returns {Array} - MongoDB aggregation pipeline
 */
function createRRFPipeline(queryText, queryEmbedding, options = {}) {
    const {
        numCandidates = 20 * 20,
        vectorWeight = 0.47,
        fullTextWeight = 1 - vectorWeight,
        divideConstant = 60,
        scoreOrderBy = -1,
        limit = 20,
        boost = {
            autocomplete_name: 1,
            text_name: 3,
        }
    } = options;

    return [
        // Vector Search Stage
        {
            "$vectorSearch": {
                "index": "vector",
                "path": "mergedNamesEmbedding",
                "queryVector": queryEmbedding,
                "numCandidates": numCandidates,
                "limit": limit,
            }
        },
        // Group vector search results
        {
            "$group": {
                "_id": null,
                "docs": { "$push": "$$ROOT" }
            }
        },
        // Unwind with rank
        {
            "$unwind": {
                "path": "$docs",
                "includeArrayIndex": "rank"
            }
        },
        // Calculate vector search score
        {
            "$addFields": {
                "vs_score": {
                    "$multiply": [
                        vectorWeight,
                        {
                            "$divide": [
                                1.0,
                                {
                                    "$add": ["$rank", divideConstant]
                                }
                            ]
                        }
                    ]
                }
            }
        },
        // Project vector search results
        {
            "$project": {
                "vs_score": 1,
                "_id": "$docs._id",
                "name": "$docs.name",
                "normalizedName": "$docs.normalizedName",
                "type": "$docs.type",
                "megatype": "$docs.megatype",
                "isExercice": "$docs.isExercice"
            }
        },
        // Union with full-text search
        {
            "$unionWith": {
                "coll": "variations",
                "pipeline": [
                    {
                        "$search": {
                            "index": "variations",
                            "compound": {
                                "should": [
                                    {
                                        "autocomplete": {
                                            "query": queryText,
                                            "path": "normalizedName.fr",
                                            "fuzzy": {
                                                "maxEdits": 1,
                                                "maxExpansions": 64
                                            },
                                            "score": { "boost": { "value": boost.autocomplete_name } }
                                        }
                                    },
                                    {
                                        "text": {
                                            "query": queryText,
                                            "path": "normalizedName.fr",
                                            "score": { "boost": { "value": boost.text_name } },
                                            "synonyms": "synonyms"
                                        }
                                    },
                                    {
                                        "autocomplete": {
                                            "query": queryText,
                                            "path": "normalizedName.en",
                                            "fuzzy": {
                                                "maxEdits": 1,
                                                "maxExpansions": 64
                                            },
                                            "score": { "boost": { "value": boost.autocomplete_name } }
                                        }
                                    },
                                    {
                                        "text": {
                                            "query": queryText,
                                            "path": "normalizedName.en",
                                            "score": { "boost": { "value": boost.text_name } },
                                            "synonyms": "synonyms"
                                        }
                                    }
                                ]
                            },
                            "scoreDetails": true
                        }
                    },
                    { "$limit": limit },
                    // Group full-text search results
                    {
                        "$group": {
                            "_id": null,
                            "docs": { "$push": "$$ROOT" }
                        }
                    },
                    // Unwind with rank
                    {
                        "$unwind": {
                            "path": "$docs",
                            "includeArrayIndex": "rank"
                        }
                    },
                    // Calculate full-text search score
                    {
                        "$addFields": {
                            "fts_score": {
                                "$multiply": [
                                    fullTextWeight,
                                    {
                                        "$divide": [
                                            1.0,
                                            {
                                                "$add": ["$rank", divideConstant]
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    },
                    // Project full-text search results
                    {
                        "$project": {
                            "fts_score": 1,
                            "_id": "$docs._id",
                            "name": "$docs.name",
                            "normalizedName": "$docs.normalizedName",
                            "type": "$docs.type",
                            "megatype": "$docs.megatype",
                            "isExercice": "$docs.isExercice"
                        }
                    }
                ]
            }
        },
        // Group by _id to combine scores
        {
            "$group": {
                "_id": "$_id",
                "name": { "$first": "$name" },
                "normalizedName": { "$first": "$normalizedName" },
                "type": { "$first": "$type" },
                "megatype": { "$first": "$megatype" },
                "vs_score": { "$max": { "$ifNull": ["$vs_score", 0] } },
                "fts_score": { "$max": { "$ifNull": ["$fts_score", 0] } },
                "isExercice": { "$first": "$isExercice" }
            }
        },
        // Calculate final score and project fields
        {
            "$project": {
                "_id": 1,
                "name": 1,
                "normalizedName": 1,
                "type": 1,
                "megatype": 1,
                "vs_score": { "$ifNull": ["$vs_score", 0] },
                "fts_score": { "$ifNull": ["$fts_score", 0] },
                "score": { "$add": ["$fts_score", "$vs_score"] },
                "isExercice": 1
            }
        },
        // Sort by final score
        { "$sort": { "score": scoreOrderBy } },
        { "$limit": limit }
    ];
}

/**
 * Reciprocal Rank Fusion search combining vector search and full-text search
 * @param {String} search - The search query
 * @param {String} type - The type of variation to search for
 * @param {String} sortBy - The field to sort by
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @param {Object} options - Additional search options
 * @returns {Object} - The variations and the total number of variations
 */
const getVariationByRRFSearch = async (search, type, options = {}) => {
    const normalizedSearch = normalizeString(search);

    const enrichedSearch = "Exercise or detail corresponding or similar to " + search + " in English or French";
    const queryEmbedding = await generateEmbedding(enrichedSearch);

    if (!queryEmbedding) {
        console.warn('Failed to generate embedding, falling back to regular search');
        const { variations } = await getVariationBySearch(normalizedSearch, type, null, 1, 7);
        return variations;
    }

    const pipeline = createRRFPipeline(normalizedSearch, queryEmbedding, options);

    if (type) {
        pipeline.unshift({
            "$match": {
                "type": new mongoose.Types.ObjectId(type)
            }
        });
    }

    pipeline.push(...lookup_type);

    const variations = await Variation.aggregate(pipeline);

    return variations;
};

/**
 * Get a variation by its ID
 * @param {String} id - The ID of the variation
 * @param {String} fields - The fields to include in the response
 * @returns {Object} - The variation
 */
const getVariationById = async (id, fields) => {
    const variation = await Variation.findById(id).select(fields).lean().exec();
    return variation;
};

function getSortedVariationIds(variationIds = []) {
    if (!variationIds?.length) return [];
    return variationIds.map(id => id.toString()).sort();
}

function getVariationSignature(variationIds = []) {
    return getSortedVariationIds(variationIds).join('|');
}

function membersFromVariationDoc(doc) {
    const ids = [doc._id.toString(), ...(doc.equivalentTo || []).map(x => x.toString())];
    return [...new Set(ids)];
}

const EQUIVALENT_PROJECTION = { mergedNamesEmbedding: 0 };

/**
 * Variations liées par equivalentTo (même signature que getEquivalentVerifiedMapFromGroups / my exercises).
 * Niveaux suivants : co-appartenance à un groupe dont `equivalentTo` a 2, 3 ou 4 entrées (document + liste = membres du cluster).
 * @param {string} variationId
 * @param {number} maxLevel 0 = direct uniquement, 1..3 = inclure 2e, 3e, 4e niveaux
 */
const getVariationEquivalents = async (variationId, maxLevel = 3) => {
    const inputId = new mongoose.Types.ObjectId(variationId);
    const input = await Variation.findById(inputId).lean();
    if (!input) {
        const err = new Error('Variation not found');
        err.statusCode = 404;
        throw err;
    }

    const assigned = new Set([inputId.toString()]);
    const directIds = new Set();
    const secondIds = new Set();
    const thirdIds = new Set();
    const fourthIds = new Set();

    if (maxLevel >= 0) {
        const sortedIds = getSortedVariationIds(input.equivalentTo || []);
        const q = { _id: { $ne: inputId } };
        if (sortedIds.length === 0) {
            q.equivalentTo = { $size: 0 };
        } else {
            q.equivalentTo = {
                $size: sortedIds.length,
                $all: sortedIds.map(id => new mongoose.Types.ObjectId(id))
            };
        }
        const directDocs = await Variation.find(q, { _id: 1 }).lean();
        for (const d of directDocs) {
            directIds.add(d._id.toString());
            assigned.add(d._id.toString());
        }
    }

    async function collectCoMembership(equivLength, targetSet) {
        const docs = await Variation.find(
            {
                equivalentTo: { $size: equivLength },
                $or: [{ _id: inputId }, { equivalentTo: inputId }]
            },
            { _id: 1, equivalentTo: 1 }
        ).lean();

        for (const doc of docs) {
            for (const m of membersFromVariationDoc(doc)) {
                if (m === inputId.toString()) continue;
                if (assigned.has(m)) continue;
                targetSet.add(m);
                assigned.add(m);
            }
        }
    }

    if (maxLevel >= 1) {
        await collectCoMembership(2, secondIds);
    }
    if (maxLevel >= 2) {
        await collectCoMembership(3, thirdIds);
    }
    if (maxLevel >= 3) {
        await collectCoMembership(4, fourthIds);
    }

    const fetchByIds = async (idSet) => {
        if (idSet.size === 0) return [];
        const ids = [...idSet].map(id => new mongoose.Types.ObjectId(id));
        return Variation.find({ _id: { $in: ids } }, EQUIVALENT_PROJECTION)
            .sort({ popularity: -1 })
            .lean();
    };

    return {
        inputVariation: input,
        directEquivalent: await fetchByIds(directIds),
        equivalentSecondLevel: await fetchByIds(secondIds),
        equivalentThirdLevel: await fetchByIds(thirdIds),
        equivalentFourthLevel: await fetchByIds(fourthIds)
    };
};

module.exports = {
    getVariationBySearch,
    getAllVariations,
    getVariationByRRFSearch,
    createRRFPipeline,
    getVariationByAI,
    getVariationById,
    getVariationEquivalents
};