const Variation = require('../schema/variation');
const { normalizeString } = require('../utils/string');

/**
 * Using atlas search autocomplete, retrieve variations from the database
 * @param {String} search - The search query
 * @param {Number} page - The page number
 * @param {Number} limit - The number of variations to return
 * @returns {Object} - The variations and the total number of variations
 */
const getVariationBySearch = async (search, page, limit) => {
    const [variations, totalResult] = await Promise.all([
        Variation.aggregate([
            {
                $search: {
                    index: "variations",
                    compound: {
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
                    compound: {
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

module.exports = { getVariationBySearch };