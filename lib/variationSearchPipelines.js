const mongoose = require('mongoose');
const { normalizeString } = require('../utils/string');

function buildVariationSearchCompound({ search, type, verified, isExercice }) {
    const normalizedSearch = normalizeString(search);
    const compound = {
        should: [
            {
                autocomplete: {
                    query: normalizedSearch,
                    path: 'name.fr',
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
                    path: 'name.fr',
                    matchCriteria: 'all',
                    score: { boost: { value: 3 } }
                }
            },
            {
                autocomplete: {
                    query: normalizedSearch,
                    path: 'name.en',
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
                    path: 'name.en',
                    matchCriteria: 'all',
                    score: { boost: { value: 3 } }
                }
            }
        ]
    };

    const filters = [];
    if (type) {
        filters.push({
            equals: {
                value: new mongoose.Types.ObjectId(type),
                path: 'type'
            }
        });
    }
    if (verified !== undefined) {
        filters.push({
            equals: {
                value: verified,
                path: 'verified'
            }
        });
    }
    if (isExercice !== undefined) {
        filters.push({
            equals: {
                value: isExercice,
                path: 'isExercice'
            }
        });
    }

    if (filters.length > 0) {
        compound.filter = filters;
        compound.minimumShouldMatch = 1;
    }

    return compound;
}

function buildMyExercisesSearchCompound({ search, userId }) {
    const normalizedSearch = normalizeString(search);
    return {
        should: [
            {
                autocomplete: {
                    query: normalizedSearch,
                    path: 'mergedVariationsNames.fr',
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
                    path: 'mergedVariationsNames.fr',
                    matchCriteria: 'all',
                    score: { boost: { value: 3 } }
                }
            },
            {
                autocomplete: {
                    query: normalizedSearch,
                    path: 'mergedVariationsNames.en',
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
                    path: 'mergedVariationsNames.en',
                    matchCriteria: 'all',
                    score: { boost: { value: 3 } }
                }
            }
        ],
        filter: [
            {
                equals: {
                    value: userId,
                    path: 'user'
                }
            }
        ],
        minimumShouldMatch: 1
    };
}

module.exports = {
    buildVariationSearchCompound,
    buildMyExercisesSearchCompound
};
