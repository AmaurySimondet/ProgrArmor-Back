const Variation = require('../schema/variation');
const { normalizeString } = require('../utils/string');
const { getOrSetCache } = require('../utils/cache');
const mongoose = require('mongoose');

/**
 * Using atlas search autocomplete, retrieve variations from the database
 * @param {String} search - The search query
 * @param {String} type - The type of variation to search for
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @returns {Object} - The variations and the total number of variations
 */
const getVariationBySearch = async (search, type, page, limit) => {
    const cacheKey = `variation_search_${normalizeString(search)}_${type}_${page}_${limit}`;

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
                }
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
 * Get all variations from the database
 * @param {String} type - The type of variation to search for
 * @returns {Object} - The variations and the total number of variations
 */
const getAllVariations = async (type) => {
    return await getOrSetCache('variations_all_' + type, async () => {
        const query = {};
        if (type) {
            query.type = new mongoose.Types.ObjectId(type);
        }
        const [variations, totalResult] = await Promise.all([
            Variation.aggregate([
                { $match: query },
                {
                    $lookup: {
                        from: 'types', // Collection name of the `type` model
                        localField: 'type',
                        foreignField: '_id',
                        as: 'typeInfo'
                    }
                },
                { $unwind: '$typeInfo' },
                { $sort: { 'typeInfo.popularityScore': -1, "normalizedName.fr": 1 } }
            ]),
            Variation.countDocuments(query)
        ]);
        return { variations, total: totalResult };
    });
};

module.exports = { getVariationBySearch, getAllVariations };