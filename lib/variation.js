const Variation = require('../schema/variation');
const { normalizeString, generateTokenCombinations, generateEmbedding, vectorSimilarity } = require('../utils/string');
const mongoose = require('mongoose');
const SeanceSet = require('../schema/seanceset');
const { isFalsy } = require('liquidjs');
const set = require('./set');
const { buildVariationSearchCompound } = require('./variationSearchPipelines');
const { search: searchConstants, variation: variationConstants } = require('../constants');

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

const {
    RRF_K,
    MY_EXERCISES_RRF_FACTOR,
    SEARCH_CANDIDATE_LIMIT,
    SEARCH_MIN_LENGTH,
    SEARCH_MAX_TIME_MS,
    SEARCH_MIN_RELATIVE_SCORE,
    SEARCH_EXACT_TOKEN_BONUS,
    SEARCH_STOPWORDS
} = searchConstants;

function getVariationIdentifier(entry) {
    if (!entry) return null;
    if (Array.isArray(entry._id) && entry._id.length > 0) {
        return entry._id.map(id => id?.toString?.() || String(id)).sort().join('|');
    }
    if (entry._id) return entry._id.toString();
    return null;
}

function getSortValue(variation, sortBy) {
    if (sortBy === 'name.en') return variation?.name?.en || '';
    if (sortBy === 'name.fr' || sortBy === 'name') return variation?.name?.fr || '';
    if (sortBy === 'popularity') return Number(variation?.popularity || 0);
    return variation?.name?.fr || '';
}

function compareSortValues(a, b, sortBy) {
    const aValue = getSortValue(a, sortBy);
    const bValue = getSortValue(b, sortBy);

    if (sortBy === 'popularity') {
        if (bValue !== aValue) return bValue - aValue;
        return (a?.name?.fr || '').localeCompare(b?.name?.fr || '');
    }
    return String(aValue).localeCompare(String(bValue), 'fr');
}

function getDisplayNames(variation) {
    if (variation?.name) {
        return { fr: variation.name.fr || '', en: variation.name.en || '' };
    }
    if (variation?.variations?.[0]?.name) {
        return {
            fr: variation.variations[0].name.fr || '',
            en: variation.variations[0].name.en || ''
        };
    }
    return { fr: '', en: '' };
}

function tokenizeExact(value) {
    const normalized = normalizeString(value || '');
    return normalized
        .split(/[^a-z0-9]+/i)
        .map(token => token.trim())
        .filter(token => token && token.length >= 3 && !SEARCH_STOPWORDS.has(token));
}

function hasExactTokenMatch(variation, searchTokens = []) {
    if (!searchTokens.length) return false;
    const names = getDisplayNames(variation);
    const itemTokens = new Set([
        ...tokenizeExact(names.fr),
        ...tokenizeExact(names.en)
    ]);
    return searchTokens.some(token => itemTokens.has(token));
}

function getNameSignature(variation) {
    const names = getDisplayNames(variation);
    const fr = normalizeString(names.fr || '').trim();
    const en = normalizeString(names.en || '').trim();
    return `${fr}||${en}`;
}

function weightedRrfMerge(primaryItems = [], myExerciseItems = [], options = {}) {
    const {
        page = 1,
        limit = 10,
        myExerciseWeight = MY_EXERCISES_RRF_FACTOR,
        sortBy = 'popularity',
        search = ''
    } = options;
    const mergedById = new Map();
    const searchTokens = tokenizeExact(search);

    primaryItems.forEach((item, index) => {
        const id = getVariationIdentifier(item);
        if (!id) return;
        const current = mergedById.get(id) || { item, score: 0, primaryRank: Number.MAX_SAFE_INTEGER, myRank: Number.MAX_SAFE_INTEGER, exactBonus: 0 };
        current.item = current.item || item;
        current.primaryRank = Math.min(current.primaryRank, index + 1);
        current.score += 1 / (RRF_K + index + 1);
        mergedById.set(id, current);
    });

    myExerciseItems.forEach((item, index) => {
        const id = getVariationIdentifier(item);
        if (!id) return;
        const current = mergedById.get(id) || { item, score: 0, primaryRank: Number.MAX_SAFE_INTEGER, myRank: Number.MAX_SAFE_INTEGER, exactBonus: 0 };
        current.item = current.item || item;
        current.myRank = Math.min(current.myRank, index + 1);
        current.score += myExerciseWeight / (RRF_K + index + 1);
        mergedById.set(id, current);
    });

    for (const entry of mergedById.values()) {
        if (hasExactTokenMatch(entry.item, searchTokens)) {
            entry.exactBonus = SEARCH_EXACT_TOKEN_BONUS;
            entry.score += SEARCH_EXACT_TOKEN_BONUS;
        }
    }

    const sortedScored = Array.from(mergedById.values())
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.primaryRank !== b.primaryRank) return a.primaryRank - b.primaryRank;
            if (a.myRank !== b.myRank) return a.myRank - b.myRank;
            return compareSortValues(a.item, b.item, sortBy);
        });

    const topScore = sortedScored.length > 0 ? sortedScored[0].score : 0;
    const filteredScored = sortedScored.filter((entry, index) => {
        if (index === 0) return true;
        if (searchTokens.length >= 2 && entry.exactBonus <= 0) return false;
        if (searchTokens.length >= 2) {
            return entry.score >= topScore * SEARCH_MIN_RELATIVE_SCORE;
        }
        return true;
    });

    const sorted = filteredScored
        .map(x => {
            const sourceRank = {};
            if (x.primaryRank !== Number.MAX_SAFE_INTEGER) sourceRank.search = x.primaryRank;
            if (x.myRank !== Number.MAX_SAFE_INTEGER) sourceRank.myExercices = x.myRank;
            return {
                ...x.item,
                sourceRank,
                rrfScore: Number(x.score.toFixed(6)),
                exactTokenBonus: Number(x.exactBonus.toFixed(6))
            };
        });

    const uniqueByName = new Map();
    for (const item of sorted) {
        const signature = getNameSignature(item);
        if (!signature || signature === '||') {
            uniqueByName.set(getVariationIdentifier(item) || `${Math.random()}`, item);
            continue;
        }
        if (!uniqueByName.has(signature)) {
            uniqueByName.set(signature, item);
        }
    }
    const deduped = Array.from(uniqueByName.values());

    const start = (page - 1) * limit;
    return {
        variations: deduped.slice(start, start + limit),
        total: deduped.length
    };
}

function getRrfCandidateLimit(page, limit) {
    const pageSizeTarget = Math.max(1, Number(page || 1)) * Math.max(1, Number(limit || 10));
    return Math.max(pageSizeTarget, SEARCH_CANDIDATE_LIMIT);
}

const getVariationBySearchBase = async (search, type, sortBy, page, limit, verified, isExercice) => {
    let sortField = 'name.fr';
    let sortOrder = 1;

    if (sortBy === 'popularity') {
        sortField = 'popularity';
        sortOrder = -1;
    } else if (sortBy === 'name.en') {
        sortField = 'name.en';
    } else if (sortBy === 'name.fr' || sortBy === 'name') {
        sortField = 'name.fr';
    }

    const compound = buildVariationSearchCompound({ search, type, verified, isExercice });
    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            {
                $search: {
                    index: "variations",
                    compound
                }
            },
            { $sort: { [sortField]: sortOrder } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            ...lookup_type,
        ]).option({ maxTimeMS: SEARCH_MAX_TIME_MS }),
        Variation.aggregate([
            {
                $search: {
                    index: "variations",
                    compound
                }
            },
            { $count: "total" }
        ]).option({ maxTimeMS: SEARCH_MAX_TIME_MS })
    ]);

    return {
        variations,
        total: totalResult.length > 0 ? totalResult[0].total : 0
    };
};

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
    const normalizedSearchInput = String(search || '').trim();
    if (!normalizedSearchInput || normalizedSearchInput.length < SEARCH_MIN_LENGTH) {
        return { variations: [], total: 0 };
    }

    const normalizedSortBy = sortBy || 'popularity';
    const shouldMergeMyExercises = Boolean(userId && search);

    if (!shouldMergeMyExercises) {
        return getVariationBySearchBase(search, type, normalizedSortBy, page, limit, verified, isExercice);
    }

    const candidateLimit = getRrfCandidateLimit(page, limit);
    const [regularSearch, myExercisesSearch] = await Promise.all([
        getVariationBySearchBase(search, type, normalizedSortBy, 1, candidateLimit, verified, isExercice),
        set.getMyExercicesSearch(userId, search, 1, candidateLimit)
    ]);

    return weightedRrfMerge(regularSearch.variations, myExercisesSearch.variations, {
        page,
        limit,
        sortBy: normalizedSortBy,
        myExerciseWeight: MY_EXERCISES_RRF_FACTOR,
        search
    });
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

const getAllVariationsBase = async (type, sortBy, userId, page = 1, limit = 20, verified, isExercice) => {
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
        return _getVariationsByFrequency(query, userId, page, limit);
    }
    if (sortBy === 'lastUsed' && userId) {
        return _getVariationsByLastUsed(query, userId, page, limit);
    }
    if (sortBy === 'popularity') {
        return _getVariationsByPopularity(query, page, limit);
    }
    return _getVariationsByName(query, page, limit, sortBy);
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
        const normalizedSortBy = sortBy || 'popularity';
        const shouldMergeMyExercises = Boolean(userId);

        if (!shouldMergeMyExercises) {
            return getAllVariationsBase(type, normalizedSortBy, userId, page, limit, verified, isExercice);
        }

        const candidateLimit = getRrfCandidateLimit(page, limit);
        const [regularAll, myExercisesAll] = await Promise.all([
            getAllVariationsBase(type, normalizedSortBy, userId, 1, candidateLimit, verified, isExercice),
            set.getMyExercicesAll(userId, 1, candidateLimit)
        ]);

        return weightedRrfMerge(regularAll.variations, myExercisesAll.variations, {
            page,
            limit,
            sortBy: normalizedSortBy,
            myExerciseWeight: MY_EXERCISES_RRF_FACTOR,
            search: ''
        });
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
                                            "path": "name.fr",
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
                                            "path": "name.fr",
                                            "score": { "boost": { "value": boost.text_name } },
                                            "synonyms": "synonyms"
                                        }
                                    },
                                    {
                                        "autocomplete": {
                                            "query": queryText,
                                            "path": "name.en",
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
                                            "path": "name.en",
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

const { EQUIVALENT_PROJECTION } = variationConstants;

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