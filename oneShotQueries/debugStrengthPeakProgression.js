/**
 * Debug strengthPeak / percentageFromStart for street figure progressions.
 *
 * Usage:
 *   node oneShotQueries/debugStrengthPeakProgression.js
 *   node oneShotQueries/debugStrengthPeakProgression.js <userId>
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';

const SCENARIOS = [
    {
        label: 'Tuck Front Lever',
        mainExerciseId: '692214541c858345acc2d41a',
        referenceVariations: ['692214541c858345acc2d41a'],
    },
    {
        label: 'Tuck Human Flag',
        mainExerciseId: '692214541c858345acc2d435',
        referenceVariations: ['692214541c858345acc2d435'],
    },
];

function isoDateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
}

async function runScenario(userId, scenario, lateralMode, dateMin) {
    const result = await setLib.getNormalizedProgressionTimeseries({
        userId,
        mainExerciseId: scenario.mainExerciseId,
        referenceVariations: scenario.referenceVariations,
        dateMin,
        dateMax: null,
        unit: null,
        lateralMode,
        valueMin: 0,
    });

    const points = Array.isArray(result?.points) ? result.points : [];
    const sp = result?.meta?.strengthPeak || null;
    const tuckPoints = points.filter((p) => {
        const rawIds = Array.isArray(p?.sourceSetVariationIds)
            ? p.sourceSetVariationIds.map((id) => String(id))
            : [];
        return rawIds.includes(String(scenario.referenceVariations[0]));
    });

    console.log('\n=== Scenario ===');
    console.log({
        label: scenario.label,
        lateralMode,
        dateMin,
        filteredSetsCount: result?.meta?.setsCount ?? points.length,
        pointsCount: points.length,
        tuckRawIdPointsCount: tuckPoints.length,
        strengthPeakScope: sp?.sourceScope ?? null,
        percentageFromStart: sp?.percentageFromStart ?? null,
        referenceKg: sp?.referenceKg ?? null,
        firstReferenceKg: sp?.firstSetPeak?.referenceKg ?? null,
        peakRawValue: sp?.source?.value ?? null,
        firstRawValue: sp?.firstSetPeak?.source?.value ?? null,
        hasEstimate: sp?.hasEstimate === true,
    });

    console.log('--- Tuck-scoped chronology (rawValue / refs) ---');
    for (const p of tuckPoints) {
        console.log({
            date: p?.date,
            rawValue: p?.rawValue,
            rawWeightLoad: p?.rawWeightLoad,
            brzycki: p?.brzycki,
            epley: p?.epley,
            normalizedOneRm: p?.normalizedOneRm,
            signature: p?.sourceVariationSignature,
        });
    }
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }

    const userId = process.argv[2] || DEFAULT_USER_ID;
    process.env.STRENGTH_PEAK_DEBUG = '1';

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    const dateMin180 = isoDateDaysAgo(180);

    for (const scenario of SCENARIOS) {
        for (const lateralMode of ['bilateral', 'left', 'right']) {
            await runScenario(userId, scenario, lateralMode, dateMin180);
        }
    }
}

run()
    .catch((err) => {
        console.error('debugStrengthPeakProgression failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
