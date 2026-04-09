const mongoose = require('mongoose');
require('dotenv').config();
const variation = require('../lib/variation');

const SEARCH_TERMS = [
    'developpe',
    'presse',
    'souleve',
    'curl',
    'extension',
    'rowing',
    'triceps',
    'squat',
    'front',
    'muscle'
];

const BASE_PARAMS = {
    type: undefined,
    sortBy: 'popularity',
    page: 1,
    limit: 10,
    verified: undefined,
    isExercice: true,
    myExercices: undefined,
    userId: '6365489f44d4b4000470882b'
};

async function run() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);

    try {
        for (const term of SEARCH_TERMS) {
            const { variations, total } = await variation.getVariationBySearch(
                term,
                BASE_PARAMS.type,
                BASE_PARAMS.sortBy,
                BASE_PARAMS.page,
                BASE_PARAMS.limit,
                BASE_PARAMS.verified,
                BASE_PARAMS.isExercice,
                BASE_PARAMS.myExercices,
                BASE_PARAMS.userId
            );

            console.log(`\n=== search="${term}" | total=${total} | returned=${variations.length} ===`);
            variations.slice(0, 10).forEach((item, index) => {
                const firstVariation = item?.variations?.[0];
                const nameFr = item?.name?.fr || firstVariation?.name?.fr || '-';
                const nameEn = item?.name?.en || firstVariation?.name?.en || '-';
                const sourceRank = item?.sourceRank ? JSON.stringify(item.sourceRank) : '-';
                const rrfScore = item?.rrfScore ?? '-';
                const exactTokenBonus = item?.exactTokenBonus ?? '-';
                console.log(`${String(index + 1).padStart(2, '0')}. fr="${nameFr}" | en="${nameEn}" | sourceRank=${sourceRank} | rrfScore=${rrfScore} | exactTokenBonus=${exactTokenBonus}`);
            });
        }
    } finally {
        await mongoose.connection.close();
    }
}

run().catch((err) => {
    console.error('Erreur testVariationSearchRefonte:', err);
    process.exitCode = 1;
});
