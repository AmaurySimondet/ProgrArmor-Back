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
    SEARCH_RECOMMENDED_MIN_TOKEN_COVERAGE,
    SEARCH_STOPWORDS
} = searchConstants;

const { GROUPED_BY_TYPE_RECOMMENDED } = variationConstants;
const RECOMMENDED_CONTEXT_TEXT_WEIGHT = 0.8;
const RECOMMENDED_CONTEXT_EQUIVALENT_WEIGHT = 0.2;

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
    if (sortBy === 'popularity') {
        if (typeof variation?.popularity === 'number') return Number(variation.popularity || 0);
        if (variation?.popularity && typeof variation.popularity === 'object') {
            return Number(variation.popularity.global || 0);
        }
        return 0;
    }
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

function variationMatchesType(entry, type) {
    if (!type) return true;
    const expectedType = type.toString();

    if (entry?.type) {
        return entry.type.toString() === expectedType;
    }

    if (!Array.isArray(entry?.variations)) {
        return false;
    }

    return entry.variations.some(v => v?.type && v.type.toString() === expectedType);
}

function variationMatchesMuscle(entry, muscle) {
    if (!muscle) return true;
    const hasMuscle = (variationDoc) => {
        const primary = variationDoc?.muscles?.primary || [];
        const secondary = variationDoc?.muscles?.secondary || [];
        return primary.includes(muscle) || secondary.includes(muscle);
    };

    if (entry?.muscles) {
        return hasMuscle(entry);
    }

    if (!Array.isArray(entry?.variations)) {
        return false;
    }

    return entry.variations.some(hasMuscle);
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

function getPopularitySortField(weightType) {
    if (weightType === 'bodyweight_plus_external') return 'popularity.bodyweight_plus_external';
    if (weightType === 'external_free') return 'popularity.external_free';
    if (weightType === 'external_machine') return 'popularity.external_machine';
    return 'popularity.global';
}

function getPopularityAddFields(weightType) {
    const contextualField = `$${getPopularitySortField(weightType)}`;
    return {
        $addFields: {
            popularitySortValue: {
                $ifNull: [
                    contextualField,
                    {
                        $ifNull: [
                            '$popularity.global',
                            {
                                $ifNull: ['$popularity', 0]
                            }
                        ]
                    }
                ]
            }
        }
    };
}

const getVariationBySearchBase = async (search, type, sortBy, page, limit, verified, isExercice, detailWeightType, muscle) => {
    let sortField = 'name.fr';
    let sortOrder = 1;
    const isDetailSearch = isExercice === false;

    if (sortBy === 'popularity') {
        sortField = isDetailSearch ? 'popularitySortValue' : 'popularity';
        sortOrder = -1;
    } else if (sortBy === 'name.en') {
        sortField = 'name.en';
    } else if (sortBy === 'name.fr' || sortBy === 'name') {
        sortField = 'name.fr';
    }

    const compound = buildVariationSearchCompound({ search, type, verified, isExercice, muscle });
    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            {
                $search: {
                    index: "variations",
                    compound
                }
            },
            ...(sortBy === 'popularity' && isDetailSearch ? [getPopularityAddFields(detailWeightType)] : []),
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
const getVariationBySearch = async (
    search,
    type,
    sortBy,
    page,
    limit,
    verified,
    isExercice,
    myExercices,
    userId,
    detailWeightType,
    recommendedVariationPopularityWeight,
    recommendedVariationUsageWeight,
    contextVariationId,
    recommendedVariationSearchWeight,
    recommendedVariationMultiTokenWeight,
    muscle
) => {
    const normalizedSearchInput = String(search || '').trim();
    if (!normalizedSearchInput || normalizedSearchInput.length < SEARCH_MIN_LENGTH) {
        return { variations: [], total: 0 };
    }

    const normalizedSortBy = sortBy || 'popularity';

    if (normalizedSortBy === 'recommended' && userId) {
        return getVariationBySearchRecommended(
            search,
            type,
            page,
            limit,
            verified,
            isExercice,
            detailWeightType,
            userId,
            recommendedVariationPopularityWeight,
            recommendedVariationUsageWeight,
            contextVariationId,
            recommendedVariationSearchWeight,
            recommendedVariationMultiTokenWeight,
            muscle
        );
    }

    if (normalizedSortBy === 'recommended' && !userId) {
        return getVariationBySearchBase(
            search,
            type,
            'popularity',
            page,
            limit,
            verified,
            isExercice,
            detailWeightType,
            muscle
        );
    }

    const shouldMergeMyExercises = Boolean(myExercices === true && userId && search);
    if (!shouldMergeMyExercises) {
        return getVariationBySearchBase(search, type, normalizedSortBy, page, limit, verified, isExercice, detailWeightType, muscle);
    }

    const candidateLimit = getRrfCandidateLimit(page, limit);
    const [regularSearch, myExercisesSearch] = await Promise.all([
        getVariationBySearchBase(search, type, normalizedSortBy, 1, candidateLimit, verified, isExercice, detailWeightType, muscle),
        set.getMyExercicesSearch(userId, search, 1, candidateLimit)
    ]);
    const filteredMyExercises = myExercisesSearch.variations.filter((item) => {
        if (type && !variationMatchesType(item, type)) return false;
        if (muscle && !variationMatchesMuscle(item, muscle)) return false;
        return true;
    });

    return weightedRrfMerge(regularSearch.variations, filteredMyExercises, {
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
const _getVariationsByPopularity = async (query, page, limit, isExercice, detailWeightType) => {
    const isDetailQuery = isExercice === false;
    const sortStage = isDetailQuery
        ? { popularitySortValue: -1, 'typeInfo.popularityScore': -1 }
        : { popularity: -1, 'typeInfo.popularityScore': -1 };

    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            { $match: query },
            ...lookup_type,
            ...(isDetailQuery ? [getPopularityAddFields(detailWeightType)] : []),
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

const getAllVariationsBase = async (type, sortBy, userId, page = 1, limit = 20, verified, isExercice, detailWeightType) => {
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
        return _getVariationsByPopularity(query, page, limit, isExercice, detailWeightType);
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
const getAllVariations = async (type, sortBy, userId, page = 1, limit = 20, verified, isExercice, myExercices, detailWeightType) => {
    try {
        const normalizedSortBy = sortBy || 'popularity';
        const shouldMergeMyExercises = Boolean(userId);

        if (!shouldMergeMyExercises) {
            return getAllVariationsBase(type, normalizedSortBy, userId, page, limit, verified, isExercice, detailWeightType);
        }

        const candidateLimit = getRrfCandidateLimit(page, limit);
        const [regularAll, myExercisesAll] = await Promise.all([
            getAllVariationsBase(type, normalizedSortBy, userId, 1, candidateLimit, verified, isExercice, detailWeightType),
            set.getMyExercicesAll(userId, 1, candidateLimit)
        ]);
        const filteredMyExercises = type
            ? myExercisesAll.variations.filter(item => variationMatchesType(item, type))
            : myExercisesAll.variations;

        return weightedRrfMerge(regularAll.variations, filteredMyExercises, {
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
 * Score catalogue d’un groupe (aligné sur le $sort Mongo des types en mode popularity).
 */
function getTypeCatalogScoreForRecommended(group, isExercice) {
    if (isExercice === false) {
        const maxP = Number(group.contextPopularity?.max ?? 0);
        const avgP = Number(group.contextPopularity?.avg ?? 0);
        const typeP = Number(group.type?.popularityScore ?? 0);
        return maxP * 1e9 + avgP * 1e3 + typeP;
    }
    return Number(group.type?.popularityScore ?? 0);
}

function resolveRecommendedWeights(recommendedPopularityWeight, recommendedUsageWeight) {
    const pop = Number(recommendedPopularityWeight);
    const usage = Number(recommendedUsageWeight);
    return {
        popularityWeight:
            Number.isFinite(pop) && pop >= 0 ? pop : GROUPED_BY_TYPE_RECOMMENDED.POPULARITY_WEIGHT,
        usageWeight:
            Number.isFinite(usage) && usage >= 0 ? usage : GROUPED_BY_TYPE_RECOMMENDED.USAGE_WEIGHT
    };
}

function resolveRecommendedVariationWeights(
    recommendedVariationPopularityWeight,
    recommendedVariationUsageWeight,
    recommendedVariationSearchWeight,
    recommendedVariationMultiTokenWeight
) {
    const pop = Number(recommendedVariationPopularityWeight);
    const usage = Number(recommendedVariationUsageWeight);
    const search = Number(recommendedVariationSearchWeight);
    const multiToken = Number(recommendedVariationMultiTokenWeight);
    return {
        popularityWeight:
            Number.isFinite(pop) && pop >= 0
                ? pop
                : GROUPED_BY_TYPE_RECOMMENDED.VARIATION_POPULARITY_WEIGHT,
        usageWeight:
            Number.isFinite(usage) && usage >= 0
                ? usage
                : GROUPED_BY_TYPE_RECOMMENDED.VARIATION_USAGE_WEIGHT,
        searchWeight:
            Number.isFinite(search) && search >= 0
                ? search
                : GROUPED_BY_TYPE_RECOMMENDED.VARIATION_SEARCH_WEIGHT,
        multiTokenWeight:
            Number.isFinite(multiToken) && multiToken >= 0
                ? multiToken
                : GROUPED_BY_TYPE_RECOMMENDED.VARIATION_MULTI_TOKEN_WEIGHT
    };
}

function getVariationCatalogScoreForRecommended(doc, isExercice) {
    if (isExercice === false) {
        return Number(doc.popularitySortValue ?? 0);
    }
    if (typeof doc.popularity === 'number') return Number(doc.popularity);
    if (doc.popularity && typeof doc.popularity === 'object') {
        return Number(doc.popularity.global ?? 0);
    }
    return 0;
}

function getVariationSearchSignals(doc, searchSignalMaps) {
    if (!searchSignalMaps) {
        return { atlasScore: 0, tokenCoverage: 0 };
    }
    const id = doc?._id?.toString();
    if (!id) {
        return { atlasScore: 0, tokenCoverage: 0 };
    }
    return {
        atlasScore: Number(searchSignalMaps.atlasScoreById?.get(id) || 0),
        tokenCoverage: Number(searchSignalMaps.tokenCoverageById?.get(id) || 0)
    };
}

/**
 * Tri recommended : toute variation avec usage > 0 passe avant usage === 0.
 * Parmi les utilisées : usage (log1p) d’abord, puis popularité. Jamais utilisées : popularité seule.
 */
function recommendedVariationSortComparator(docA, docB, usageMap, isExercice, weights, searchSignalMaps = null) {
    const idA = docA?._id?.toString();
    const idB = docB?._id?.toString();
    const na = idA ? Number(usageMap.get(idA) || 0) : 0;
    const nb = idB ? Number(usageMap.get(idB) || 0) : 0;
    const usedA = na > 0;
    const usedB = nb > 0;
    if (usedA !== usedB) {
        if (usedB && !usedA) return 1;
        if (usedA && !usedB) return -1;
    }
    if (usedA && usedB) {
        const usageScoreA = weights.usageWeight * Math.log1p(na);
        const usageScoreB = weights.usageWeight * Math.log1p(nb);
        if (usageScoreB !== usageScoreA) return usageScoreB > usageScoreA ? 1 : -1;
        const popA = weights.popularityWeight * getVariationCatalogScoreForRecommended(docA, isExercice);
        const popB = weights.popularityWeight * getVariationCatalogScoreForRecommended(docB, isExercice);
        const searchA = getVariationSearchSignals(docA, searchSignalMaps);
        const searchB = getVariationSearchSignals(docB, searchSignalMaps);
        const relevanceA =
            popA +
            (weights.searchWeight * searchA.atlasScore) +
            (weights.multiTokenWeight * searchA.tokenCoverage);
        const relevanceB =
            popB +
            (weights.searchWeight * searchB.atlasScore) +
            (weights.multiTokenWeight * searchB.tokenCoverage);
        if (relevanceB !== relevanceA) return relevanceB > relevanceA ? 1 : -1;
        if (popB !== popA) return popB > popA ? 1 : -1;
        return (docA?.name?.fr || '').localeCompare(docB?.name?.fr || '');
    }
    let catA = getVariationCatalogScoreForRecommended(docA, isExercice);
    let catB = getVariationCatalogScoreForRecommended(docB, isExercice);
    const zeroMult = GROUPED_BY_TYPE_RECOMMENDED.VARIATION_ZERO_USAGE_CATALOG_MULTIPLIER;
    if (zeroMult < 1) {
        catA *= zeroMult;
        catB *= zeroMult;
    }
    const searchA = getVariationSearchSignals(docA, searchSignalMaps);
    const searchB = getVariationSearchSignals(docB, searchSignalMaps);
    const relevanceA =
        (weights.popularityWeight * catA) +
        (weights.searchWeight * searchA.atlasScore) +
        (weights.multiTokenWeight * searchA.tokenCoverage);
    const relevanceB =
        (weights.popularityWeight * catB) +
        (weights.searchWeight * searchB.atlasScore) +
        (weights.multiTokenWeight * searchB.tokenCoverage);
    if (relevanceB !== relevanceA) return relevanceB > relevanceA ? 1 : -1;
    if (catB !== catA) return catB > catA ? 1 : -1;
    return (docA?.name?.fr || '').localeCompare(docB?.name?.fr || '');
}

/** Même principe que les variations : types avec usage utilisateur > 0 avant les autres. */
function recommendedGroupedTypeSortComparator(gA, gB, usageByType, isExercice, weights) {
    const idA = gA?.type?._id?.toString();
    const idB = gB?.type?._id?.toString();
    const na = idA ? Number(usageByType.get(idA) || 0) : 0;
    const nb = idB ? Number(usageByType.get(idB) || 0) : 0;
    const usedA = na > 0;
    const usedB = nb > 0;
    if (usedA !== usedB) {
        if (usedB && !usedA) return 1;
        if (usedA && !usedB) return -1;
    }
    if (usedA && usedB) {
        const uA = weights.usageWeight * Math.log1p(na);
        const uB = weights.usageWeight * Math.log1p(nb);
        if (uB !== uA) return uB > uA ? 1 : -1;
        const cA = weights.popularityWeight * getTypeCatalogScoreForRecommended(gA, isExercice);
        const cB = weights.popularityWeight * getTypeCatalogScoreForRecommended(gB, isExercice);
        if (cB !== cA) return cB > cA ? 1 : -1;
        return (gA?.type?.name?.fr || '').localeCompare(gB?.type?.name?.fr || '');
    }
    const cA = weights.popularityWeight * getTypeCatalogScoreForRecommended(gA, isExercice);
    const cB = weights.popularityWeight * getTypeCatalogScoreForRecommended(gB, isExercice);
    if (cB !== cA) return cB > cA ? 1 : -1;
    return (gA?.type?.name?.fr || '').localeCompare(gB?.type?.name?.fr || '');
}

function rankVariationsForRecommended(
    variations,
    usageByVariation,
    isExercice,
    variationWeights,
    skip,
    safeLimit
) {
    const ranked = [...variations].sort((docA, docB) =>
        recommendedVariationSortComparator(docA, docB, usageByVariation, isExercice, variationWeights)
    );
    return ranked.slice(skip, skip + safeLimit);
}

function mergeRankingsWithWeightedRRF(primaryDocs, secondaryDocs, primaryWeight, secondaryWeight) {
    const mergedById = new Map();
    const safePrimaryWeight = Number.isFinite(Number(primaryWeight)) ? Math.max(0, Number(primaryWeight)) : 0;
    const safeSecondaryWeight = Number.isFinite(Number(secondaryWeight)) ? Math.max(0, Number(secondaryWeight)) : 0;

    const upsert = (doc, key) => {
        if (!doc?._id) return null;
        const id = doc._id.toString();
        if (!mergedById.has(id)) {
            mergedById.set(id, {
                id,
                doc,
                score: 0,
                primaryRank: Number.POSITIVE_INFINITY,
                secondaryRank: Number.POSITIVE_INFINITY
            });
        }
        const row = mergedById.get(id);
        if (key === 'primary') row.doc = doc;
        return row;
    };

    for (let index = 0; index < primaryDocs.length; index += 1) {
        const row = upsert(primaryDocs[index], 'primary');
        if (!row) continue;
        row.primaryRank = Math.min(row.primaryRank, index);
        if (safePrimaryWeight > 0) {
            row.score += safePrimaryWeight / (RRF_K + index + 1);
        }
    }

    for (let index = 0; index < secondaryDocs.length; index += 1) {
        const row = upsert(secondaryDocs[index], 'secondary');
        if (!row) continue;
        row.secondaryRank = Math.min(row.secondaryRank, index);
        if (safeSecondaryWeight > 0) {
            row.score += safeSecondaryWeight / (RRF_K + index + 1);
        }
    }

    return [...mergedById.values()]
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.primaryRank !== b.primaryRank) return a.primaryRank - b.primaryRank;
            if (a.secondaryRank !== b.secondaryRank) return a.secondaryRank - b.secondaryRank;
            return String(a.doc?.name?.fr || '').localeCompare(String(b.doc?.name?.fr || ''));
        })
        .map((entry) => entry.doc);
}

function enforceUsedBeforeUnused(rankedDocs, usageMap) {
    if (!Array.isArray(rankedDocs) || rankedDocs.length === 0) return [];
    const used = [];
    const unused = [];
    for (const doc of rankedDocs) {
        const id = doc?._id?.toString();
        const count = id ? Number(usageMap?.get(id) || 0) : 0;
        if (count > 0) used.push(doc);
        else unused.push(doc);
    }
    return [...used, ...unused];
}

function unionFindModule() {
    const parent = new Map();
    function find(x) {
        if (!parent.has(x)) parent.set(x, x);
        if (parent.get(x) !== x) {
            parent.set(x, find(parent.get(x)));
        }
        return parent.get(x);
    }
    function union(a, b) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    }
    return { find, union };
}

/**
 * Pour chaque variation d’exercice, ensemble des autres IDs du même cluster (union des equivalentTo).
 */
async function loadExerciseEquivalentPeerMap() {
    const docs = await Variation.find({ isExercice: true }, { equivalentTo: 1 }).lean();
    const uf = unionFindModule();
    for (const d of docs) {
        const self = d._id.toString();
        uf.find(self);
        for (const e of d.equivalentTo || []) {
            uf.union(self, e.toString());
        }
    }
    const rootToMembers = new Map();
    for (const d of docs) {
        const self = d._id.toString();
        const r = uf.find(self);
        if (!rootToMembers.has(r)) rootToMembers.set(r, new Set());
        rootToMembers.get(r).add(self);
        for (const e of d.equivalentTo || []) {
            rootToMembers.get(r).add(e.toString());
        }
    }
    const maxCluster = GROUPED_BY_TYPE_RECOMMENDED.EQUIVALENT_SPILLOVER_MAX_CLUSTER_SIZE;
    const peerMap = new Map();
    for (const members of rootToMembers.values()) {
        if (members.size < 2 || members.size > maxCluster) continue;
        const arr = [...members];
        for (const id of arr) {
            if (!peerMap.has(id)) peerMap.set(id, new Set());
            for (const o of arr) {
                if (o !== id) peerMap.get(id).add(o);
            }
        }
    }
    return peerMap;
}

function expandRecommendedVariationUsageWithSpillover(usageMap, peerMap, spillWeight) {
    if (spillWeight <= 0 || !peerMap || peerMap.size === 0) {
        return new Map(usageMap);
    }
    const out = new Map(usageMap);
    for (const [loggedId, w] of usageMap) {
        const peers = peerMap.get(loggedId);
        if (!peers || peers.size === 0) continue;
        const delta = w * spillWeight;
        for (const p of peers) {
            out.set(p, (out.get(p) || 0) + delta);
        }
    }
    return out;
}

/**
 * IDs en [0] liés à une variation de base (base isExercice=true + docs avec equivalentTo ⊃ base).
 * null si base introuvable — l’appelant n’applique alors pas de filtre contextuel.
 */
async function loadContextPrimaryLinkedIds(contextVariationId) {
    if (!contextVariationId) return null;
    try {
        const baseOid = new mongoose.Types.ObjectId(contextVariationId);
        const baseDoc = await Variation.findOne({ _id: baseOid, isExercice: true }, { _id: 1 }).lean();
        if (!baseDoc) return null;
        const linked = await Variation.find({ equivalentTo: baseOid }, { _id: 1 }).lean();
        return [baseOid, ...linked.map((d) => d._id)];
    } catch {
        return null;
    }
}

async function loadContextEquivalentExerciseRankedList({ contextVariationId, type, verified, muscle, limit }) {
    if (!contextVariationId || !mongoose.Types.ObjectId.isValid(contextVariationId)) return [];

    const rootDoc = await Variation.findOne(
        { _id: new mongoose.Types.ObjectId(contextVariationId), isExercice: true },
        { _id: 1, equivalentTo: 1 }
    ).lean();
    if (!rootDoc) return [];

    const familySeedIds = set.resolveFamilySeedIds(rootDoc._id.toString(), rootDoc);
    const prefixes = set.buildVariationPrefixes(familySeedIds);
    if (!prefixes.length) return [];

    const normalizedPrefixes = prefixes.map((prefix) => prefix.map((id) => String(id)));
    const getPrefixDepthFromEquivalentTo = (equivalentTo = []) => {
        const equivalentSet = new global.Set((equivalentTo || []).map((id) => String(id)));
        let bestDepth = 0;
        for (const prefix of normalizedPrefixes) {
            const matches = prefix.every((id) => equivalentSet.has(id));
            if (matches && prefix.length > bestDepth) {
                bestDepth = prefix.length;
            }
        }
        return bestDepth;
    };

    const orFilters = [
        { _id: { $in: [...new global.Set([rootDoc._id.toString(), ...familySeedIds])].map((id) => new mongoose.Types.ObjectId(id)) } }
    ];
    for (const prefix of prefixes) {
        orFilters.push({
            equivalentTo: {
                $all: prefix.map((id) => new mongoose.Types.ObjectId(id))
            }
        });
    }

    const match = {
        isExercice: true,
        $or: orFilters
    };
    if (type) {
        if (!mongoose.Types.ObjectId.isValid(type)) return [];
        match.type = new mongoose.Types.ObjectId(type);
    }
    if (typeof verified === 'boolean') {
        match.verified = verified;
    }
    if (muscle && typeof muscle === 'string') {
        match.$and = [
            { $or: [{ 'muscle.primary': muscle }, { 'muscle.secondary': muscle }] }
        ];
    }

    const docs = await Variation.aggregate([
        { $match: match },
        { $sort: { popularity: -1, createdAt: 1 } },
        { $limit: Math.max(1, Number(limit || GROUPED_BY_TYPE_RECOMMENDED.VARIATION_SEARCH_CANDIDATE_LIMIT)) },
        ...lookup_type
    ]).option({ maxTimeMS: SEARCH_MAX_TIME_MS });

    const scored = docs
        .map((doc, idx) => {
            const id = doc?._id?.toString();
            const prefixDepth = getPrefixDepthFromEquivalentTo(doc?.equivalentTo || []);
            const seedIndex = familySeedIds.indexOf(id);
            const rootBoost = id === rootDoc._id.toString() ? 1 : 0;
            return {
                doc,
                idx,
                prefixDepth,
                seedRank: seedIndex >= 0 ? seedIndex : Number.POSITIVE_INFINITY,
                rootBoost
            };
        })
        .sort((a, b) => {
            if (b.rootBoost !== a.rootBoost) return b.rootBoost - a.rootBoost;
            if (b.prefixDepth !== a.prefixDepth) return b.prefixDepth - a.prefixDepth;
            if (a.seedRank !== b.seedRank) return a.seedRank - b.seedRank;
            const popA = getTypeCatalogScoreForRecommended(a.doc, true);
            const popB = getTypeCatalogScoreForRecommended(b.doc, true);
            if (popB !== popA) return popB - popA;
            return a.idx - b.idx;
        })
        .map((entry) => entry.doc);

    return scored;
}

/**
 * Signatures `getVariationSignature(equivalentTo)` → variation canonique (verified, isExercice),
 * départage popularité puis createdAt comme getEquivalentVerifiedMapFromGroups.
 */
async function loadVerifiedExerciseCompositionSignatureMap() {
    const docs = await Variation.find(
        {
            verified: true,
            isExercice: true,
            'equivalentTo.0': { $exists: true }
        },
        { equivalentTo: 1, type: 1, popularity: 1, createdAt: 1 }
    )
        .sort({ popularity: -1, createdAt: 1 })
        .lean();

    let maxEquivLen = 1;
    const signatureMap = new Map();
    for (const d of docs) {
        const list = d.equivalentTo || [];
        if (list.length === 0) continue;
        maxEquivLen = Math.max(maxEquivLen, list.length);
        const sig = getVariationSignature(list);
        if (!signatureMap.has(sig)) {
            signatureMap.set(sig, { _id: d._id, type: d.type });
        }
    }
    return { signatureMap, maxEquivLen };
}

/**
 * Plus long préfixe de variations (slots 0..k-1) dont la signature matche un `equivalentTo` vérifié ;
 * sinon équivalent à l’ancien comportement (slot 0 seul).
 */
function resolveExercisePrimaryFromLoggedVariations(variations, signatureMap, maxEquivLen) {
    if (!variations?.length) return null;
    const ids = variations.map((v) => v?.variation?.toString()).filter(Boolean);
    if (!ids.length) return null;

    const prefixCap = GROUPED_BY_TYPE_RECOMMENDED.EXERCISE_COMPOSITION_PREFIX_MAX_SLOTS;
    const kMax = Math.min(ids.length, maxEquivLen, prefixCap);

    for (let k = kMax; k >= 1; k--) {
        const sig = getVariationSignature(ids.slice(0, k));
        const canon = signatureMap.get(sig);
        if (canon) {
            return {
                variationId: canon._id.toString(),
                typeId: canon.type ? canon.type.toString() : null
            };
        }
    }
    return {
        variationId: ids[0],
        typeId: variations[0]?.type?.toString() || null
    };
}

/**
 * Même forme que le $facet Mongo (détails) : [{ byType, byVariation }] pour recommended exos.
 */
async function aggregateExercisePrimaryUsageFacet(userObjectId) {
    const { signatureMap, maxEquivLen } = await loadVerifiedExerciseCompositionSignatureMap();
    const byVariation = new Map();
    const byType = new Map();

    const cursor = SeanceSet.find({
        user: userObjectId,
        'variations.0': { $exists: true }
    })
        .select('variations')
        .lean()
        .cursor();

    for await (const doc of cursor) {
        const resolved = resolveExercisePrimaryFromLoggedVariations(
            doc.variations,
            signatureMap,
            maxEquivLen
        );
        if (!resolved?.variationId) continue;
        const vId = resolved.variationId;
        const tId = resolved.typeId;
        byVariation.set(vId, (byVariation.get(vId) || 0) + 1);
        if (tId) {
            byType.set(tId, (byType.get(tId) || 0) + 1);
        }
    }

    const byVariationRows = [...byVariation.entries()].map(([id, usageCount]) => ({
        _id: new mongoose.Types.ObjectId(id),
        usageCount
    }));
    const byTypeRows = [...byType.entries()].map(([id, usageCount]) => ({
        _id: new mongoose.Types.ObjectId(id),
        usageCount
    }));

    return [{ byType: byTypeRows, byVariation: byVariationRows }];
}

async function aggregatePrimarySlotUsageByVariation(userObjectId) {
    const [facet] = await aggregateExercisePrimaryUsageFacet(userObjectId);
    const rows = facet?.byVariation || [];
    return rows.map((r) => ({ _id: r._id, count: r.usageCount }));
}

async function aggregateDetailSlotUsageByVariation(userObjectId, primarySlotFilterIds) {
    const match = {
        user: userObjectId,
        'variations.1': { $exists: true }
    };
    if (primarySlotFilterIds && primarySlotFilterIds.length > 0) {
        match.$expr = {
            $in: [{ $arrayElemAt: ['$variations.variation', 0] }, primarySlotFilterIds]
        };
    }
    return SeanceSet.aggregate([
        { $match: match },
        {
            $unwind: {
                path: '$variations',
                includeArrayIndex: '_detailSlot'
            }
        },
        { $match: { _detailSlot: { $gt: 0 } } },
        {
            $group: {
                _id: '$variations.variation',
                count: { $sum: 1 }
            }
        }
    ]);
}

/**
 * Atlas Search + score hybride (popularité contextuelle + usage slot [0] pour exos, slots >0 pour détails).
 * contextVariationId : pour détails uniquement, filtre l’usage sur les séries dont [0] est lié à cet exercice (base + equivalentTo).
 */
async function getVariationBySearchRecommended(
    search,
    type,
    page,
    limit,
    verified,
    isExercice,
    detailWeightType,
    userId,
    recommendedVariationPopularityWeight,
    recommendedVariationUsageWeight,
    contextVariationId,
    recommendedVariationSearchWeight,
    recommendedVariationMultiTokenWeight,
    muscle
) {
    const normalizedSearchInput = String(search || '').trim();
    if (!normalizedSearchInput || normalizedSearchInput.length < SEARCH_MIN_LENGTH) {
        return { variations: [], total: 0 };
    }

    const variationWeights = resolveRecommendedVariationWeights(
        recommendedVariationPopularityWeight,
        recommendedVariationUsageWeight,
        recommendedVariationSearchWeight,
        recommendedVariationMultiTokenWeight
    );
    const candidateLimit = Math.max(
        Math.max(1, Number(limit || 10)),
        GROUPED_BY_TYPE_RECOMMENDED.VARIATION_SEARCH_CANDIDATE_LIMIT
    );
    const compound = buildVariationSearchCompound({ search, type, verified, isExercice, muscle });
    const isDetailSearch = isExercice === false;

    const searchStages = [
        {
            $search: {
                index: 'variations',
                compound
            }
        },
        {
            $addFields: {
                atlasSearchScore: { $meta: 'searchScore' }
            }
        },
        ...(isDetailSearch ? [getPopularityAddFields(detailWeightType)] : []),
        { $limit: candidateLimit },
        ...lookup_type
    ];

    const userObjectId = new mongoose.Types.ObjectId(userId);
    let primaryFilter = null;
    if (isDetailSearch && contextVariationId) {
        primaryFilter = await loadContextPrimaryLinkedIds(contextVariationId);
    }

    const useExercisePrimaryUsage = !isDetailSearch;

    const [candidates, usageRows, equivalentPeerMap] = await Promise.all([
        Variation.aggregate(searchStages).option({ maxTimeMS: SEARCH_MAX_TIME_MS }),
        useExercisePrimaryUsage
            ? aggregatePrimarySlotUsageByVariation(userObjectId)
            : aggregateDetailSlotUsageByVariation(userObjectId, primaryFilter),
        useExercisePrimaryUsage ? loadExerciseEquivalentPeerMap() : Promise.resolve(new Map())
    ]);

    const searchTokens = tokenizeExact(search);
    const maxAtlasScore = candidates.reduce((max, doc) => {
        const v = Number(doc?.atlasSearchScore || 0);
        return v > max ? v : max;
    }, 0);
    const atlasScoreById = new Map();
    const tokenCoverageById = new Map();
    for (const doc of candidates) {
        const id = doc?._id?.toString();
        if (!id) continue;
        const normalizedAtlas = maxAtlasScore > 0 ? Number(doc?.atlasSearchScore || 0) / maxAtlasScore : 0;
        atlasScoreById.set(id, normalizedAtlas);

        if (searchTokens.length === 0) {
            tokenCoverageById.set(id, 0);
            continue;
        }
        const names = getDisplayNames(doc);
        const itemTokens = new Set([
            ...tokenizeExact(names.fr),
            ...tokenizeExact(names.en)
        ]);
        const matchCount = searchTokens.reduce((acc, token) => acc + (itemTokens.has(token) ? 1 : 0), 0);
        tokenCoverageById.set(id, matchCount / searchTokens.length);
    }
    const searchSignalMaps = { atlasScoreById, tokenCoverageById };
    const minCoverage = Math.max(
        0,
        Math.min(1, Number(SEARCH_RECOMMENDED_MIN_TOKEN_COVERAGE ?? 1))
    );
    const filteredCandidates = searchTokens.length >= 2
        ? candidates.filter((doc) => {
            const id = doc?._id?.toString();
            if (!id) return false;
            return Number(tokenCoverageById.get(id) || 0) >= minCoverage;
        })
        : candidates;
    const rankingBase = filteredCandidates.length > 0 ? filteredCandidates : candidates;

    const usageMap = new Map(usageRows.map((r) => [r._id.toString(), r.count]));
    let usageForScore = usageMap;
    if (useExercisePrimaryUsage) {
        usageForScore = expandRecommendedVariationUsageWithSpillover(
            usageMap,
            equivalentPeerMap,
            GROUPED_BY_TYPE_RECOMMENDED.VARIATION_EQUIVALENT_SPILLOVER_WEIGHT
        );
    }

    const ranked = rankingBase
        .map((doc, searchRank) => ({ doc, searchRank }))
        .sort((a, b) => {
            const c = recommendedVariationSortComparator(
                a.doc,
                b.doc,
                usageForScore,
                isExercice,
                variationWeights,
                searchSignalMaps
            );
            if (c !== 0) return c;
            return a.searchRank - b.searchRank;
        })
        .map(({ doc }) => doc);

    let rankedWithContextFusion = ranked;
    if (isExercice === true && contextVariationId) {
        const equivalentRanked = await loadContextEquivalentExerciseRankedList({
            contextVariationId,
            type,
            verified,
            muscle,
            limit: candidateLimit
        });
        if (equivalentRanked.length > 0) {
            rankedWithContextFusion = mergeRankingsWithWeightedRRF(
                ranked,
                equivalentRanked,
                RECOMMENDED_CONTEXT_TEXT_WEIGHT,
                RECOMMENDED_CONTEXT_EQUIVALENT_WEIGHT
            );
        }
    }
    if (isExercice === true) {
        rankedWithContextFusion = enforceUsedBeforeUnused(rankedWithContextFusion, usageForScore);
    }

    const skip = Math.max(0, (page - 1) * limit);
    const safeLimit = Math.max(1, limit);

    return {
        variations: rankedWithContextFusion.slice(skip, skip + safeLimit),
        total: rankedWithContextFusion.length
    };
}

/**
 * Usage pour sortBy=recommended (détails uniquement) : variations[1..], pas l’exo parent.
 * Les exercices (isExercice true) utilisent `aggregateExercisePrimaryUsageFacet` (normalisation equivalentTo).
 * @param {mongoose.Types.ObjectId[]|null} primarySlotFilterIds — si défini, ne compter que les séries dont [0] est dans ce jeu.
 */
function buildRecommendedSeanceUsageDetailUsageFacetPipeline(userObjectId, primarySlotFilterIds = null) {
    const firstMatch = {
        user: userObjectId,
        'variations.1': { $exists: true }
    };
    if (primarySlotFilterIds && primarySlotFilterIds.length > 0) {
        firstMatch.$expr = {
            $in: [{ $arrayElemAt: ['$variations.variation', 0] }, primarySlotFilterIds]
        };
    }
    return [
        { $match: firstMatch },
        {
            $unwind: {
                path: '$variations',
                includeArrayIndex: '_detailSlot'
            }
        },
        { $match: { _detailSlot: { $gt: 0 } } },
        {
            $facet: {
                byType: [{ $group: { _id: '$variations.type', usageCount: { $sum: 1 } } }],
                byVariation: [{ $group: { _id: '$variations.variation', usageCount: { $sum: 1 } } }]
            }
        }
    ];
}

/**
 * Get variations grouped by type (types ordered by popularityScore, or recommended + usage si sortBy=recommended et userId).
 * Pagination (page/limit) is applied inside each type group.
 * @returns {Object} - { groups, totalTypes }
 */
const getVariationsGroupedByType = async (
    sortBy = 'recommended',
    page = 1,
    limit = 10,
    verified,
    isExercice,
    detailWeightType,
    type,
    typesPage,
    typesLimit,
    userId,
    recommendedPopularityWeight,
    recommendedUsageWeight,
    recommendedVariationPopularityWeight,
    recommendedVariationUsageWeight,
    contextVariationId,
    muscle
) => {
    const query = {};
    if (verified !== undefined) {
        query.verified = verified;
    }
    if (isExercice !== undefined) {
        query.isExercice = isExercice;
    }
    if (type) {
        query.type = new mongoose.Types.ObjectId(type);
    }
    if (muscle) {
        query.$or = [
            { 'muscles.primary': muscle },
            { 'muscles.secondary': muscle }
        ];
    }

    const normalizedSortBy = sortBy || 'recommended';
    const variationSortLikePopularity =
        normalizedSortBy === 'popularity' || normalizedSortBy === 'recommended';
    const sortStages = [];

    if (variationSortLikePopularity) {
        if (isExercice === false) {
            sortStages.push(getPopularityAddFields(detailWeightType));
            sortStages.push({ $sort: { popularitySortValue: -1, 'name.fr': 1 } });
        } else {
            sortStages.push({ $sort: { popularity: -1, 'name.fr': 1 } });
        }
    } else if (normalizedSortBy === 'name.en') {
        sortStages.push({ $sort: { 'name.en': 1 } });
    } else {
        sortStages.push({ $sort: { 'name.fr': 1 } });
    }

    const skip = Math.max(0, (page - 1) * limit);
    const safeLimit = Math.max(1, limit);
    const hasTypesPagination = Number.isFinite(Number(typesLimit)) && Number(typesLimit) > 0;
    const normalizedTypesPage = Math.max(1, Number(typesPage || 1));
    const normalizedTypesLimit = hasTypesPagination ? Math.max(1, Number(typesLimit)) : null;
    const typeSkip = hasTypesPagination ? (normalizedTypesPage - 1) * normalizedTypesLimit : 0;

    if (normalizedSortBy === 'recommended' && userId) {
        const weights = resolveRecommendedWeights(recommendedPopularityWeight, recommendedUsageWeight);
        const variationWeights = resolveRecommendedVariationWeights(
            recommendedVariationPopularityWeight,
            recommendedVariationUsageWeight
        );
        const candidateLimit = Math.max(
            safeLimit,
            GROUPED_BY_TYPE_RECOMMENDED.VARIATION_CANDIDATE_LIMIT_PER_TYPE
        );

        const userObjectId = new mongoose.Types.ObjectId(userId);
        let primarySlotFilterIds = null;
        if (isExercice === false && contextVariationId) {
            primarySlotFilterIds = await loadContextPrimaryLinkedIds(contextVariationId);
        }
        const [usageFacet, groupsRaw, equivalentPeerMap] = await Promise.all([
            isExercice === false
                ? SeanceSet.aggregate(
                      buildRecommendedSeanceUsageDetailUsageFacetPipeline(userObjectId, primarySlotFilterIds)
                  )
                : aggregateExercisePrimaryUsageFacet(userObjectId),
            Variation.aggregate([
                { $match: query },
                ...lookup_type,
                ...sortStages,
                {
                    $group: {
                        _id: '$typeInfo._id',
                        type: { $first: '$typeInfo' },
                        variations: { $push: '$$ROOT' },
                        totalVariations: { $sum: 1 },
                        maxContextPopularity: { $max: '$popularitySortValue' },
                        avgContextPopularity: { $avg: '$popularitySortValue' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        type: 1,
                        totalVariations: 1,
                        variations: { $slice: ['$variations', 0, candidateLimit] },
                        contextPopularity: {
                            max: '$maxContextPopularity',
                            avg: '$avgContextPopularity'
                        }
                    }
                }
            ]),
            isExercice === true ? loadExerciseEquivalentPeerMap() : Promise.resolve(new Map())
        ]);

        const facetRow = usageFacet[0] || { byType: [], byVariation: [] };
        const usageByType = new Map(
            (facetRow.byType || []).map(row => [row._id.toString(), row.usageCount])
        );
        let usageByVariation = new Map(
            (facetRow.byVariation || []).map(row => [row._id.toString(), row.usageCount])
        );
        if (isExercice === true) {
            usageByVariation = expandRecommendedVariationUsageWithSpillover(
                usageByVariation,
                equivalentPeerMap,
                GROUPED_BY_TYPE_RECOMMENDED.VARIATION_EQUIVALENT_SPILLOVER_WEIGHT
            );
        }

        const groupsWithRankedVariations = groupsRaw.map((g) => ({
            ...g,
            variations: rankVariationsForRecommended(
                g.variations || [],
                usageByVariation,
                isExercice,
                variationWeights,
                skip,
                safeLimit
            )
        }));

        const groupsAll = [...groupsWithRankedVariations].sort((gA, gB) =>
            recommendedGroupedTypeSortComparator(gA, gB, usageByType, isExercice, weights)
        );

        const groups = hasTypesPagination
            ? groupsAll.slice(typeSkip, typeSkip + normalizedTypesLimit)
            : groupsAll;

        return {
            groups,
            totalTypes: groupsAll.length
        };
    }

    if ((normalizedSortBy === 'frequency' || normalizedSortBy === 'lastUsed') && userId) {
        const metricAggregation = await SeanceSet.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId) } },
            { $unwind: '$variations' },
            {
                $group: normalizedSortBy === 'frequency'
                    ? { _id: '$variations.variation', metric: { $sum: 1 } }
                    : { _id: '$variations.variation', metric: { $max: '$date' } }
            }
        ]);

        const metricMap = new Map(metricAggregation.map(row => [row._id.toString(), row.metric]));
        const docs = await Variation.aggregate([
            { $match: query },
            ...lookup_type
        ]);

        const groupedMap = new Map();
        for (const doc of docs) {
            const key = doc.typeInfo?._id?.toString();
            if (!key) continue;
            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    type: doc.typeInfo,
                    totalVariations: 0,
                    variations: []
                });
            }
            const group = groupedMap.get(key);
            group.totalVariations += 1;
            group.variations.push({
                ...doc,
                metricSortValue: metricMap.get(doc._id.toString()) || (normalizedSortBy === 'frequency' ? 0 : null)
            });
        }

        const groupsAll = Array.from(groupedMap.values())
            .map(group => {
                group.variations.sort((a, b) => {
                    if (normalizedSortBy === 'frequency') {
                        const diff = Number(b.metricSortValue || 0) - Number(a.metricSortValue || 0);
                        if (diff !== 0) return diff;
                        return (a?.name?.fr || '').localeCompare(b?.name?.fr || '');
                    }
                    const aTs = a.metricSortValue ? new Date(a.metricSortValue).getTime() : 0;
                    const bTs = b.metricSortValue ? new Date(b.metricSortValue).getTime() : 0;
                    if (bTs !== aTs) return bTs - aTs;
                    return (a?.name?.fr || '').localeCompare(b?.name?.fr || '');
                });
                return {
                    type: group.type,
                    totalVariations: group.totalVariations,
                    variations: group.variations.slice(skip, skip + safeLimit)
                };
            })
            .sort((a, b) => {
                const scoreDiff = Number(b?.type?.popularityScore || 0) - Number(a?.type?.popularityScore || 0);
                if (scoreDiff !== 0) return scoreDiff;
                return (a?.type?.name?.fr || '').localeCompare(b?.type?.name?.fr || '');
            });

        const groups = hasTypesPagination
            ? groupsAll.slice(typeSkip, typeSkip + normalizedTypesLimit)
            : groupsAll;

        return {
            groups,
            totalTypes: groupsAll.length
        };
    }

    const mongoGroupSortUsesPopularity =
        normalizedSortBy === 'popularity' ||
        (normalizedSortBy === 'recommended' && !userId);

    const [groups, totalTypesResult] = await Promise.all([
        Variation.aggregate([
            { $match: query },
            ...lookup_type,
            ...sortStages,
            {
                $group: {
                    _id: '$typeInfo._id',
                    type: { $first: '$typeInfo' },
                    variations: { $push: '$$ROOT' },
                    totalVariations: { $sum: 1 },
                    maxContextPopularity: { $max: '$popularitySortValue' },
                    avgContextPopularity: { $avg: '$popularitySortValue' }
                }
            },
            {
                $sort: mongoGroupSortUsesPopularity && isExercice === false
                    ? { maxContextPopularity: -1, avgContextPopularity: -1, 'type.popularityScore': -1, 'type.name.fr': 1 }
                    : { 'type.popularityScore': -1, 'type.name.fr': 1 }
            },
            {
                $project: {
                    _id: 0,
                    type: 1,
                    totalVariations: 1,
                    variations: { $slice: ['$variations', skip, safeLimit] },
                    contextPopularity: {
                        max: '$maxContextPopularity',
                        avg: '$avgContextPopularity'
                    }
                }
            },
            ...(hasTypesPagination ? [{ $skip: typeSkip }, { $limit: normalizedTypesLimit }] : [])
        ]),
        Variation.aggregate([
            { $match: query },
            ...lookup_type,
            { $group: { _id: '$typeInfo._id' } },
            { $count: 'total' }
        ])
    ]);

    return {
        groups,
        totalTypes: totalTypesResult.length > 0 ? totalTypesResult[0].total : 0
    };
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
    getVariationsGroupedByType,
    getVariationByRRFSearch,
    createRRFPipeline,
    getVariationByAI,
    getVariationById,
    getVariationEquivalents
};