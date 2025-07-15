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
 * Get all variations from the database
 * @param {String} type - The type of variation to search for
 * @param {String} sortBy - The field to sort by
 * @param {String} userId - The user ID for frequency-based sorting
 * @returns {Object} - The variations and the total number of variations
 */
const getAllVariations = async (type, sortBy, userId) => {
    return await getOrSetCache('variations_all_' + type + '_' + sortBy + '_' + userId, async () => {
        const query = {};
        if (type) {
            query.type = new mongoose.Types.ObjectId(type);
        }

        let sortStage = { 'typeInfo.popularityScore': -1, "normalizedName.fr": 1 }

        if (sortBy === 'name') {
            sortStage = { 'typeInfo.popularityScore': -1, "normalizedName.fr": 1 }
        } else if (sortBy === 'frequency' && userId) {
            console.log('frequency', userId);
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
                    ...lookup_type
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

            return { variations: variationsWithFrequency, total: totalResult };
        } else {
            sortStage = { 'typeInfo.popularityScore': -1, "normalizedName.fr": 1 }
        }

        const [variations, totalResult] = await Promise.all([
            Variation.aggregate([
                { $match: query },
                ...lookup_type,
                { $sort: sortStage }
            ]),
            Variation.countDocuments(query)
        ]);
        return { variations, total: totalResult };
    });
};

module.exports = { getVariationBySearch, getAllVariations };