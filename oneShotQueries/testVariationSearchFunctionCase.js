const mongoose = require('mongoose');
require('dotenv').config();

const variationLib = require('../lib/variation');
const Variation = require('../schema/variation');
const { normalizeString } = require('../utils/string');

const CASE_PARAMS = {
    search: 'déve',
    type: undefined,
    sortBy: 'recommended',
    page: 1,
    limit: 8,
    verified: undefined,
    isExercice: true,
    myExercices: undefined,
    userId: '6365489f44d4b4000470882b',
    detailWeightType: undefined,
    recommendedVariationPopularityWeight: undefined,
    recommendedVariationUsageWeight: undefined,
    contextVariationId: undefined,
    recommendedVariationSearchWeight: undefined,
    recommendedVariationMultiTokenWeight: undefined,
    muscle: 'chest',
    weightType: undefined
};

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in env');
    }
    return mongoUrl + database;
}

async function run() {
    const mongoUri = getMongoUri();
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    try {
        console.log('\n--- Test fonction getVariationBySearch (sans HTTP) ---');
        console.log('Params:', CASE_PARAMS);

        const {
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
            muscle,
            weightType
        } = CASE_PARAMS;

        const fnResult = await variationLib.getVariationBySearch(
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
            muscle,
            weightType
        );

        const returnedCount = Array.isArray(fnResult.variations) ? fnResult.variations.length : 0;
        console.log('Résultat fonction: total =', fnResult.total, '| variations.length =', returnedCount);

        const normalized = normalizeString(search);
        const baseRegexQuery = {
            $or: [
                { 'name.fr': { $regex: normalized, $options: 'i' } },
                { 'name.en': { $regex: normalized, $options: 'i' } }
            ]
        };
        const withFiltersRegexQuery = {
            ...baseRegexQuery,
            isExercice: true,
            $and: [
                {
                    $or: [
                        { 'muscles.primary': muscle },
                        { 'muscles.secondary': muscle }
                    ]
                }
            ]
        };

        const [regexAnyCount, regexFilteredCount, regexExamples] = await Promise.all([
            Variation.countDocuments(baseRegexQuery),
            Variation.countDocuments(withFiltersRegexQuery),
            Variation.find(withFiltersRegexQuery)
                .select('name muscles isExercice')
                .limit(5)
                .lean()
        ]);

        console.log('\nDiagnostic DB (regex, indicatif):');
        console.log(`- Match nom "${normalized}" sans filtres:`, regexAnyCount);
        console.log(`- Match nom "${normalized}" + isExercice=true + muscle=${muscle}:`, regexFilteredCount);

        if (regexExamples.length > 0) {
            console.log('- Exemples filtrés (max 5):');
            regexExamples.forEach((v, i) => {
                console.log(`  [${i}] ${v?.name?.fr || v?.name?.en || v?._id}`);
            });
        }

        if (returnedCount === 0) {
            console.log('\nConclusion: EMPTY sur la fonction (pas lié à l’auth HTTP).');
            if (regexFilteredCount === 0) {
                console.log('Cause probable: aucun document ne matche simultanément le texte + muscle + isExercice.');
            } else {
                console.log('Cause probable: Atlas/recommended ranking ne retient aucun candidat sur ce terme.');
            }
        } else {
            console.log(`\nConclusion: NON EMPTY sur la fonction (${returnedCount} résultat(s)).`);
        }
    } finally {
        await mongoose.connection.close();
        console.log('\nConnexion Mongo fermée');
    }
}

run().catch((error) => {
    console.error('Erreur test fonction:', error);
    process.exitCode = 1;
});
