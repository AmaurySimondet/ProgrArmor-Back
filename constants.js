const SEARCH_STOPWORDS = new Set([
    'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'et', 'en', 'au', 'aux',
    'the', 'a', 'an', 'and', 'of', 'to', 'in', 'on'
]);

const UPPER_BODY_MUSCLES = [
    "chest",
    "upper_back",
    "lats",
    "traps",
    "neck",
    "deltoids_front",
    "deltoids_side",
    "deltoids_rear",
    "biceps",
    "triceps",
    "forearms",
    "abs",
    "obliques",
    "spinal_erectors"
];

const LOWER_BODY_MUSCLES = [
    "glutes",
    "hamstrings",
    "quads",
    "adductors",
    "abductors",
    "calves"
];

const MUSCLES = [...UPPER_BODY_MUSCLES, ...LOWER_BODY_MUSCLES];

const SUCCESS_TYPES = ["seances", "kgs", "n_exercises", "secret", "prs", "serie", "exercise"];

const CIRCUMFERENCE_KEYS = [
    "neck",
    "shoulders",
    "chest",
    "waist",
    "hips",
    "leftBiceps",
    "rightBiceps",
    "leftForearm",
    "rightForearm",
    "leftThigh",
    "rightThigh",
    "leftCalf",
    "rightCalf"
];

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

module.exports = {
    search: {
        RRF_K: 60,
        MY_EXERCISES_RRF_FACTOR: Number.isFinite(Number(process.env.MY_EXERCISES_RRF_FACTOR))
            ? Number(process.env.MY_EXERCISES_RRF_FACTOR)
            : 0.5,
        SEARCH_CANDIDATE_LIMIT: Number.isFinite(Number(process.env.SEARCH_CANDIDATE_LIMIT))
            ? Number(process.env.SEARCH_CANDIDATE_LIMIT)
            : 24,
        SEARCH_MIN_LENGTH: Number.isFinite(Number(process.env.SEARCH_MIN_LENGTH))
            ? Number(process.env.SEARCH_MIN_LENGTH)
            : 2,
        SEARCH_MAX_TIME_MS: Number.isFinite(Number(process.env.SEARCH_MAX_TIME_MS))
            ? Number(process.env.SEARCH_MAX_TIME_MS)
            : 2500,
        SEARCH_MIN_RELATIVE_SCORE: Number.isFinite(Number(process.env.SEARCH_MIN_RELATIVE_SCORE))
            ? Number(process.env.SEARCH_MIN_RELATIVE_SCORE)
            : 0.60,
        SEARCH_EXACT_TOKEN_BONUS: Number.isFinite(Number(process.env.SEARCH_EXACT_TOKEN_BONUS))
            ? Number(process.env.SEARCH_EXACT_TOKEN_BONUS)
            : 0.02,
        SEARCH_STOPWORDS
    },
    server: {
        JWT_SECRET: process.env.JWT_SECRET,
        DATABASE: process.env.DATABASE,
        MONGO_URL: process.env.mongoURL,
        MONGO_MAX_POOL_SIZE: Number(process.env.MONGO_MAX_POOL_SIZE || 5),
        PORT: process.env.PORT || 8800,
        HOST: process.env.LISTEN_HOST || '0.0.0.0'
    },
    set: {
        PR_CATEGORIES
    },
    user: {
        ONE_DAY: 24 * 60 * 60 * 1000,
        CIRCUMFERENCE_KEYS,
        CM_PER_FT: 30.48,
        KG_PER_LB: 0.45359237,
        CM_PER_IN: 2.54,
        HEIGHT_CM_DECIMALS: 2,
        HEIGHT_FT_DECIMALS: 4,
        WEIGHT_KG_DECIMALS: 2,
        WEIGHT_LB_DECIMALS: 2,
        CIRC_CM_DECIMALS: 2,
        CIRC_IN_DECIMALS: 2
    },
    week: {
        ONE_DAY_MS: 24 * 60 * 60 * 1000,
        ONE_WEEK_MS: 7 * 24 * 60 * 60 * 1000,
        UTC_MONDAY_EPOCH_MS: Date.UTC(1970, 0, 5)
    },
    whichWeight: {
        MAX_SESSION_SETS: 50
    },
    detail: {
        PAGINATION_LIMIT: 10
    },
    success: {
        SUCCESS_ALL_MAX_LIMIT: 200,
        SUCCESS_TYPES
    },
    schema: {
        UPPER_BODY_MUSCLES,
        LOWER_BODY_MUSCLES,
        MUSCLES
    },
    variation: {
        EQUIVALENT_PROJECTION: { mergedNamesEmbedding: 0 }
    }
};
