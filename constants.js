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
        EQUIVALENT_PROJECTION: { mergedNamesEmbedding: 0 },
        /**
         * Tri `sortBy=recommended` sur /variation/grouped-by-type et /variation/search (avec userId) :
         * strate 1 : tout ce que l’utilisateur a loggé (usage > 0) avant le reste.
         * strate « utilisé » : USAGE_WEIGHT * log1p(usage) puis POPULARITY_WEIGHT * score catalogue en tie-break.
         * strate « jamais utilisé » : popularité catalogue (× VARIATION_ZERO_USAGE_CATALOG_MULTIPLIER pour les variations).
         * Exos : préfixe de `variations` (du plus long au plus court) normalisé vers une variation vérifiée si `equivalentTo` matche exactement le même jeu d’IDs (comme my exercises) ; sinon [0]. Puis spillover equivalentTo. Détails : slots > 0 ; `contextVariationId` filtre [0] base ∪ { equivalentTo ⊃ base }.
         */
        GROUPED_BY_TYPE_RECOMMENDED: {
            POPULARITY_WEIGHT: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_POPULARITY_WEIGHT);
                return Number.isFinite(v) && v >= 0 ? v : 1;
            })(),
            USAGE_WEIGHT: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_USAGE_WEIGHT);
                return Number.isFinite(v) && v >= 0 ? v : 1;
            })(),
            /** Tri des variations dans chaque type (sortBy=recommended + userId) : pool des N plus populaires puis score hybride. */
            VARIATION_POPULARITY_WEIGHT: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_VARIATION_POPULARITY_WEIGHT);
                return Number.isFinite(v) && v >= 0 ? v : 1;
            })(),
            VARIATION_USAGE_WEIGHT: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_VARIATION_USAGE_WEIGHT);
                return Number.isFinite(v) && v >= 0 ? v : 2.5;
            })(),
            VARIATION_CANDIDATE_LIMIT_PER_TYPE: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_VARIATION_CANDIDATE_LIMIT_PER_TYPE);
                return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 50;
            })(),
            /**
             * Taille max du préfixe de `variations` testée pour matcher un `equivalentTo` vérifié (garde-fou données aberrantes).
             */
            EXERCISE_COMPOSITION_PREFIX_MAX_SLOTS: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_EXERCISE_COMPOSITION_PREFIX_MAX_SLOTS);
                return Number.isFinite(v) && v >= 2 ? Math.floor(v) : 16;
            })(),
            /** 1 = désactivé. < 1 réduit légèrement le poids du catalogue si l’utilisateur n’a jamais loggé cette variation (évite Squat/Pompes en #1 si jamais faits). */
            VARIATION_ZERO_USAGE_CATALOG_MULTIPLIER: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_VARIATION_ZERO_USAGE_CATALOG_MULTIPLIER);
                return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.93;
            })(),
            /**
             * Réservé (recommended exos : normalisation préfixe + equivalentTo ; détails = slots > 0).
             * Conservés pour compatibilité env / évolution future.
             */
            VARIATION_PRIMARY_SLOT_WEIGHT: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_PRIMARY_SLOT_WEIGHT);
                return Number.isFinite(v) && v >= 0 ? v : 1;
            })(),
            VARIATION_SECONDARY_SLOT_WEIGHT: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_SECONDARY_SLOT_WEIGHT);
                return Number.isFinite(v) && v >= 0 ? v : 0.35;
            })(),
            /**
             * Part du score d’usage (après slots) propagée aux autres IDs du cluster `equivalentTo`
             * (ex. Zercher / Smith → crédit réduit vers Squat). 0 = désactivé. Uniquement si isExercice=true.
             */
            VARIATION_EQUIVALENT_SPILLOVER_WEIGHT: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_EQUIVALENT_SPILLOVER_WEIGHT);
                return Number.isFinite(v) && v >= 0 ? v : 0.25;
            })(),
            /**
             * Clusters equivalentTo plus grands que ce seuil : pas de spillover (évite un mega-graphe qui gonfle artificiellement certaines variations).
             */
            EQUIVALENT_SPILLOVER_MAX_CLUSTER_SIZE: (() => {
                const v = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_EQUIVALENT_SPILLOVER_MAX_CLUSTER_SIZE);
                return Number.isFinite(v) && v >= 2 ? Math.floor(v) : 24;
            })()
        }
    }
};
