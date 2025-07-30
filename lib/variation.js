const Variation = require('../schema/variation');
const { normalizeString } = require('../utils/string');
const { getOrSetCache } = require('../utils/cache');
const mongoose = require('mongoose');
const SeanceSet = require('../schema/seanceset');

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
 * @returns {Object} - The variations and the total number of variations
 */
const getVariationBySearch = async (search, type, sortBy, page, limit) => {
    const cacheKey = `variation_search_${normalizeString(search)}_${type}_${sortBy}_${page}_${limit}`;

    let sortField = 'normalizedName.fr';
    let sortOrder = 1;
    if (sortBy === 'name') {
        sortField = 'normalizedName.fr';
        sortOrder = 1;
    } else if (sortBy === 'type') {
        sortBy = 'typeInfo.popularityScore';
    } else {
        sortBy = 'normalizedName.fr';
    }

    return await getOrSetCache(cacheKey, async () => {
        const compound = {
            should: [
                {
                    autocomplete: {
                        query: normalizeString(search),
                        path: "normalizedName.fr",
                        fuzzy: {
                            maxEdits: 1,
                            prefixLength: 3
                        }
                    }
                },
                {
                    autocomplete: {
                        query: normalizeString(search),
                        path: "normalizedName.en",
                        fuzzy: {
                            maxEdits: 1,
                            prefixLength: 3
                        }
                    }
                }
            ]
        }
        if (type) {
            compound.filter = {
                equals: {
                    value: new mongoose.Types.ObjectId(type),
                    path: "type"
                }
            };
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
                    $limit: limit
                },
                {
                    $skip: (page - 1) * limit
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
const _getVariationsWithDefaultSort = async (query, page, limit) => {
    const sortStage = { 'typeInfo.popularityScore': -1, "normalizedName.fr": 1 };

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
 * @returns {Object} - The variations and the total number of variations
 */
const getAllVariations = async (type, sortBy, userId, page = 1, limit = 20) => {
    return await getOrSetCache('variations_all_' + type + '_' + sortBy + '_' + userId + '_' + page + '_' + limit, async () => {
        const query = {};
        if (type) {
            query.type = new mongoose.Types.ObjectId(type);
        }

        if (sortBy === 'frequency' && userId) {
            return await _getVariationsByFrequency(query, userId, page, limit);
        } else if (sortBy === 'lastUsed' && userId) {
            return await _getVariationsByLastUsed(query, userId, page, limit);
        } else { // popularity + name
            return await _getVariationsWithDefaultSort(query, page, limit);
        }
    });
};

module.exports = { getVariationBySearch, getAllVariations };