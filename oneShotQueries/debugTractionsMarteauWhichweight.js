/**
 * Compare whichweight (workout legacy) vs whichweight-figure (profile stats)
 * for Tractions + prise Marteau (or similar).
 *
 * Usage:
 *   node oneShotQueries/debugTractionsMarteauWhichweight.js
 *   node oneShotQueries/debugTractionsMarteauWhichweight.js <userId> <variationId>
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');
const whichweight = require('../lib/whichweight');
const whichfigure = require('../lib/whichfigure');
const { resolveMainExerciseIdForProgression } = require('../lib/progressionResolution');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';
const TARGET_REPS = 10;
const WINDOW_DAYS = 180;

function getIsoDateLocalDaysAgo(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function findTractionsMarteauVariations() {
    const docs = await Variation.find(
        {
            $or: [
                { 'name.fr': /traction/i },
                { 'name.en': /pull.?up/i },
            ],
        },
        { name: 1, isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1, type: 1 },
    ).lean();
    const marteau = docs.filter((doc) => /marteau|hammer|neutral/i.test(
        `${doc?.name?.fr || ''} ${doc?.name?.en || ''}`,
    ));
    const tractions = docs.filter((doc) => /traction|pull/i.test(
        `${doc?.name?.fr || ''} ${doc?.name?.en || ''}`,
    ));
    return { marteau, tractions, all: docs };
}

async function run() {
    const userId = process.argv[2] || DEFAULT_USER_ID;
    const forcedVariationId = process.argv[3] || null;

    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    await mongoose.connect(mongoUrl + database);

    let variationIds = forcedVariationId ? [forcedVariationId] : [];
    if (!variationIds.length) {
        const { marteau, tractions } = await findTractionsMarteauVariations();
        console.log('\n=== Variations Tractions / Marteau trouvées ===');
        console.log('Marteau:', marteau.map((d) => ({ id: String(d._id), name: d.name })));
        console.log('Tractions (sample):', tractions.slice(0, 8).map((d) => ({ id: String(d._id), name: d.name })));

        const exercise = tractions.find((d) => d.isExercice === true) || tractions[0];
        const detail = marteau.find((d) => d.isExercice !== true) || marteau[0];
        if (exercise) variationIds.push(String(exercise._id));
        if (detail && !variationIds.includes(String(detail._id))) variationIds.push(String(detail._id));
    }

    if (!variationIds.length) {
        console.error('Aucune variation Tractions/Marteau trouvée — passe un variationId en argument.');
        process.exit(1);
    }

    console.log('\n=== Config test ===', { userId, variationIds, targetReps: TARGET_REPS });

    const dateMin = getIsoDateLocalDaysAgo(WINDOW_DAYS);
    const variationsPayload = variationIds.map((id) => ({ variation: id }));

    console.log('\n--- WORKOUT PATH: whichweight (legacy) ---');
    const legacy = await whichweight.computeRecommendedLoad({
        userId,
        variations: variationsPayload,
        targetUnit: 'repetitions',
        targetValue: TARGET_REPS,
        sessionSets: [],
    });
    console.log(JSON.stringify({
        success: legacy.success,
        loadKg: legacy.loadKg,
        loadKgWithBodyweight: legacy.loadKgWithBodyweight,
        usedSets: legacy.usedSets,
        userWeightKg: legacy.userWeightKg,
        exerciseBodyWeightRatioUsed: legacy.exerciseBodyWeightRatioUsed,
        strengthPeak: legacy.strengthPeak,
        targetVariation: legacy.targetVariation,
    }, null, 2));

    const mainExerciseId = await resolveMainExerciseIdForProgression(variationIds[0]);
    console.log('\n--- PROFILE PATH: whichweight-figure ---', { mainExerciseId, dateMin });
    const figure = await whichfigure.computeRecommendedWeightFigure({
        userId,
        mainExerciseId,
        referenceVariations: variationIds,
        targetUnit: 'repetitions',
        targetValue: TARGET_REPS,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        dateMin,
        lateralMode: 'bilateral',
    });

    const direct = (figure.recommendations || []).find((e) => e?.isDirect === true)
        || (figure.recommendations || []).find((e) => String(e?.variationId || '').includes(String(variationIds[0])));
    console.log(JSON.stringify({
        success: figure.success,
        referenceVariationId: figure.referenceVariationId,
        directRecommendation: direct ? {
            name: direct.name,
            recommendedLoadKg: direct.recommendedLoadKg,
            recommendedEffectiveWeightLoadKg: direct.recommendedEffectiveWeightLoadKg,
            usedSets: direct.usedSets,
            strengthPeak: direct.strengthPeak,
            bodyweight: direct.bodyweight,
        } : null,
        recommendationCount: figure.recommendations?.length ?? 0,
    }, null, 2));

    console.log('\n=== Écart workout vs profil ===');
    console.log({
        legacyLoadKg: legacy.loadKg,
        figureDirectLoadKg: direct?.recommendedLoadKg ?? null,
        deltaKg: Number.isFinite(Number(legacy.loadKg)) && Number.isFinite(Number(direct?.recommendedLoadKg))
            ? Number(legacy.loadKg) - Number(direct.recommendedLoadKg)
            : null,
        legacyHistoricalSets: legacy.usedSets?.usedHistoricalSets,
        figureHistoricalSets: direct?.usedSets?.usedHistoricalSets,
    });

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
