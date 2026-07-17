const mongoose = require('mongoose');
const { normalizeString } = require('../utils/string');

const ALIASES_TEXT_BOOST = 7;
const ALIASES_AUTOCOMPLETE_BOOST = 2;
const MUSCLE_PRIMARY_TEXT_BOOST = 3;

const FUZZY_AUTOCOMPLETE = {
    maxEdits: 1,
    prefixLength: 0,
    maxExpansions: 50,
};

function buildAliasSearchShould(normalizedSearch, aliasPath) {
    return [
        {
            autocomplete: {
                query: normalizedSearch,
                path: aliasPath,
                fuzzy: FUZZY_AUTOCOMPLETE,
                score: { boost: { value: ALIASES_AUTOCOMPLETE_BOOST } },
            },
        },
        {
            text: {
                query: normalizedSearch,
                path: aliasPath,
                matchCriteria: 'all',
                score: { boost: { value: ALIASES_TEXT_BOOST } },
            },
        },
    ];
}

function buildVariationSearchCompound({ search, type, verified, isExercice, muscle, weightType }) {
    const normalizedSearch = normalizeString(search);
    const compound = {
        should: [
            ...buildAliasSearchShould(normalizedSearch, 'aliases'),
            {
                text: {
                    query: normalizedSearch,
                    path: 'muscles.primary',
                    score: { boost: { value: MUSCLE_PRIMARY_TEXT_BOOST } },
                },
            },
        ],
    };

    const filters = [];
    if (type) {
        filters.push({
            equals: {
                value: new mongoose.Types.ObjectId(type),
                path: 'type',
            },
        });
    }
    if (verified !== undefined) {
        filters.push({
            equals: {
                value: verified,
                path: 'verified',
            },
        });
    }
    if (isExercice !== undefined) {
        filters.push({
            equals: {
                value: isExercice,
                path: 'isExercice',
            },
        });
    }
    if (muscle) {
        filters.push({
            compound: {
                should: [
                    {
                        equals: {
                            value: muscle,
                            path: 'muscles.primary',
                        },
                    },
                    {
                        equals: {
                            value: muscle,
                            path: 'muscles.secondary',
                        },
                    },
                ],
                minimumShouldMatch: 1,
            },
        });
    }
    if (weightType) {
        filters.push({
            equals: {
                value: weightType,
                path: 'weightType',
            },
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
        should: buildAliasSearchShould(normalizedSearch, 'mergedAliases'),
        filter: [
            {
                equals: {
                    value: userId,
                    path: 'user',
                },
            },
        ],
        minimumShouldMatch: 1,
    };
}

function buildSelfmadeVisibilityFilter(userId) {
    if (!userId) {
        return { selfmade: false };
    }
    return {
        $or: [
            { selfmade: false },
            { madeByUser: new mongoose.Types.ObjectId(userId) },
        ],
    };
}

function mergeQueryWithSelfmadeVisibility(baseQuery = {}, userId) {
    const visibility = buildSelfmadeVisibilityFilter(userId);
    const hasBaseKeys = baseQuery && Object.keys(baseQuery).length > 0;
    if (!hasBaseKeys) {
        return visibility;
    }
    return { $and: [baseQuery, visibility] };
}

function isVariationVisibleToUser(doc, userId) {
    if (!doc?.selfmade) {
        return true;
    }
    if (!userId || !doc?.madeByUser) {
        return false;
    }
    return String(doc.madeByUser) === String(userId);
}

module.exports = {
    ALIASES_TEXT_BOOST,
    ALIASES_AUTOCOMPLETE_BOOST,
    MUSCLE_PRIMARY_TEXT_BOOST,
    buildVariationSearchCompound,
    buildMyExercisesSearchCompound,
    buildSelfmadeVisibilityFilter,
    mergeQueryWithSelfmadeVisibility,
    isVariationVisibleToUser,
};
