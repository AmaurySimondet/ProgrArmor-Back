/**
 * Debug whichweight/value for Développé couché barre guidée (single exercise selection).
 *
 * Usage:
 *   node oneShotQueries/debugSmithBenchWhichweight.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');
const whichfigure = require('../lib/whichfigure');
const Variation = require('../schema/variation');

const USER_ID = '6365489f44d4b4000470882b';
const SMITH_BENCH_ID = '6922144c1c858345acc2d0ce';
const REFERENCE_VARIATIONS = [SMITH_BENCH_ID];
const WINDOW_DAYS = 180;

function getIsoDateLocalDaysAgo(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function label(entry) {
    if (!entry?.name) return entry?.variationId || entry?.variationSignature || '?';
    if (typeof entry.name === 'string') return entry.name;
    return entry.name.fr || entry.name.en || '?';
}

function entryKey(entry) {
    return entry?.variationSignature || entry?.variationId || '';
}

function countUsedHistoricalSetsFromPrs(prs) {
    if (!prs || typeof prs !== 'object') return 0;
    const ids = new Set();
    for (const key of Object.keys(prs)) {
        const rep = prs?.[key]?.repetitions;
        const sec = prs?.[key]?.seconds;
        if (rep?._id != null) ids.add(String(rep._id));
        if (sec?._id != null) ids.add(String(sec._id));
    }
    return ids.size;
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    await mongoose.connect(mongoUrl + database);

    const dateMin180 = getIsoDateLocalDaysAgo(WINDOW_DAYS);
    const doc = await Variation.findById(SMITH_BENCH_ID, { name: 1, equivalentTo: 1, isExercice: 1 }).lean();
    console.log('=== Variation ===');
    console.log(doc?.name?.fr, SMITH_BENCH_ID);
    console.log('equivalentTo:', (doc?.equivalentTo || []).map(String));

    const familyPayload = await setLib.resolvePerformedFamilyTargets({
        userId: USER_ID,
        variations: REFERENCE_VARIATIONS,
        familyKey: null,
        dateMin: dateMin180,
        lateralMode: 'bilateral',
    });
    console.log(`\n=== Family rows (${WINDOW_DAYS}j) ===`);
    for (const row of familyPayload.rows) {
        console.log(`- "${row.name?.fr}" progressionSig=${row.progressionSignature} chartSig=${row.chartSourceVariationSignature} count=${row.count}`);
    }

    const [figurePayload, progressionPayload] = await Promise.all([
        setLib.getFigureDetailedPRs({
            userId: USER_ID,
            referenceVariations: REFERENCE_VARIATIONS,
            mainExerciseId: SMITH_BENCH_ID,
            dateMin: dateMin180,
            lateralMode: 'bilateral',
            includeAllGraphTargets: true,
            maxTargets: 40,
        }),
        setLib.getProgressionDetailedPRs({
            userId: USER_ID,
            referenceVariations: REFERENCE_VARIATIONS,
            mainExerciseId: SMITH_BENCH_ID,
            dateMin: dateMin180,
            lateralMode: 'bilateral',
            includeAllGraphTargets: true,
            maxTargets: 40,
        }),
    ]);

    console.log('\n=== Figure detailed entries ===');
    for (const e of figurePayload.entries) {
        console.log(`  key=${entryKey(e)} isDirect=${e.isDirect} prSlots=${countUsedHistoricalSetsFromPrs(e.prs)} name="${label(e)}"`);
    }

    console.log('\n=== Progression detailed entries ===');
    console.log('referenceVariationSignature:', progressionPayload.referenceVariationSignature);
    for (const e of progressionPayload.entries) {
        console.log(`  key=${entryKey(e)} isDirect=${e.isDirect} prSlots=${countUsedHistoricalSetsFromPrs(e.prs)} name="${label(e)}"`);
    }

    const valueResult = await whichfigure.computeRecommendedValueFigure({
        userId: USER_ID,
        mainExerciseId: SMITH_BENCH_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        targetUnit: 'repetitions',
        effectiveWeightLoad: 95.5,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        lateralMode: 'bilateral',
        dateMin: dateMin180,
    });

    console.log(`\n=== whichvalue @95.5kg (${WINDOW_DAYS}j) ===`);
    for (const r of valueResult.recommendations || []) {
        console.log(`  key=${r.variationSignature || r.variationId} reps=${r.recommendedValue} prSlots=${r.usedSets?.usedHistoricalSets} isDirect=${r.isDirect} name="${label(r)}"`);
    }

    const familyKeys = new Set(familyPayload.rows.flatMap((r) => [r.progressionSignature, r.chartSourceVariationSignature]));
    const recKeys = new Set((valueResult.recommendations || []).map((r) => String(r.variationSignature || r.variationId)));
    console.log('\n=== Missing from whichvalue vs family ===');
    for (const row of familyPayload.rows) {
        const sig = row.progressionSignature;
        const chartSig = row.chartSourceVariationSignature;
        if (!recKeys.has(sig) && !recKeys.has(chartSig)) {
            console.log(`MISSING: "${row.name?.fr}" progressionSig=${sig} chartSig=${chartSig}`);
        }
    }
}

run()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
