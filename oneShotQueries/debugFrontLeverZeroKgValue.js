/**
 * Trace whichvalue @0kg vs PR slots for Front Lever (Tuck / Advanced Tuck).
 *
 * Usage:
 *   node oneShotQueries/debugFrontLeverZeroKgValue.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const whichfigure = require('../lib/whichfigure');
const setLib = require('../lib/set');

const USER_ID = '6365489f44d4b4000470882b';
const TUCK_FL_ID = '692214541c858345acc2d41a';
const WINDOW_DAYS = 180;

function getIsoDateLocalDaysAgo(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function label(entry) {
    if (!entry?.name) return '?';
    if (typeof entry.name === 'string') return entry.name;
    return entry.name.fr || entry.name.en || '?';
}

function summarizePrSlots(prs) {
    const rows = [];
    for (const key of Object.keys(prs || {})) {
        if (key !== 'Last' && !/^\d+RM$/.test(key)) continue;
        for (const unit of ['repetitions', 'seconds']) {
            const slot = prs?.[key]?.[unit];
            if (!slot?._id) continue;
            rows.push({
                rmKey: key,
                unit,
                setId: String(slot._id),
                value: slot.value,
                weightLoad: slot.weightLoad,
                normalizedOneRm: slot.normalizedOneRm,
                normalizedEpley: slot.normalizedEpley,
                normalizedOneRmForRecommendation: slot.normalizedOneRmForRecommendation,
                normalizedEffectiveWeightLoad: slot.normalizedEffectiveWeightLoad,
                brzycki: slot.brzycki,
                epley: slot.epley,
            });
        }
    }
    return rows;
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    await mongoose.connect(mongoUrl + database);

    const dateMin180 = getIsoDateLocalDaysAgo(WINDOW_DAYS);
    const result = await whichfigure.computeRecommendedValueFigure({
        userId: USER_ID,
        mainExerciseId: TUCK_FL_ID,
        referenceVariations: [TUCK_FL_ID],
        targetUnit: 'repetitions',
        effectiveWeightLoad: 0,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        lateralMode: 'bilateral',
        dateMin: dateMin180,
    });

    const focusNames = ['Tuck Front Lever', 'Advanced Tuck Front Lever', 'One Leg Front Lever'];
    console.log('\n=== Recommendations @0kg ===');
    for (const rec of result.recommendations || []) {
        const name = label(rec);
        if (!focusNames.some((n) => name.includes(n.split(' ')[0]) && name.includes('Front Lever'))) continue;
        if (!name.includes('Front Lever')) continue;
        const peak = rec.strengthPeak || {};
        console.log(`\n--- ${name} ---`);
        console.log('recommendedValue:', rec.recommendedValue);
        console.log('success:', rec.success);
        console.log('usedHistoricalSets:', rec.usedSets?.usedHistoricalSets);
        console.log('bodyweight:', rec.bodyweight);
        console.log('effectiveWeightLoadKg:', rec.effectiveWeightLoadKg);
        console.log('peak used:', {
            rmKey: peak.rmKey,
            setId: peak.setId,
            rawValue: peak.value,
            weightLoad: peak.weightLoad,
            normalizedOneRm: peak.normalizedOneRm,
            normalizedOneRmForRecommendation: peak.normalizedOneRmForRecommendation,
            normalizedOneRmRaw: peak.normalizedOneRmRaw,
            normalizedEffectiveWeightLoad: peak.normalizedEffectiveWeightLoad,
        });
    }

    const figurePayload = await setLib.getFigureDetailedPRs({
        userId: USER_ID,
        referenceVariations: [TUCK_FL_ID],
        mainExerciseId: TUCK_FL_ID,
        dateMin: dateMin180,
        lateralMode: 'bilateral',
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
    });

    console.log('\n=== Advanced Tuck @0kg — diagnostic détaillé ===');
    for (const rec of result.recommendations || []) {
        const name = label(rec);
        if (!name.includes('Advanced Tuck Front Lever')) continue;
        const peak = rec.strengthPeak || {};
        console.log(JSON.stringify({
            name,
            recommendedValue: rec.recommendedValue,
            peakRawReps: peak.value,
            peakWeightLoad: peak.weightLoad,
            peakNormalizedOneRmChargeUtile: peak.normalizedOneRm,
            peakNormalizedOneRmForRecommendation: peak.normalizedOneRmForRecommendation,
            peakDifficultyRatioUsed: peak.difficultyRatioUsed,
            peakRmKey: peak.rmKey,
            peakSetId: peak.setId,
            peakExtrapolated: peak.extrapolated === true,
            discrepancyVsPr: Number.isFinite(Number(rec.recommendedValue)) && Number.isFinite(Number(peak.value))
                ? Number(rec.recommendedValue) - Number(peak.value)
                : null,
        }, null, 2));
    }

    console.log('\n=== PR slots in figure detailed (Tuck / Advanced signatures) ===');
    for (const entry of figurePayload.entries) {
        const name = label(entry);
        if (!name.includes('Tuck Front Lever') && !name.includes('Advanced Tuck')) continue;
        console.log(`\n${name} key=${entry.variationSignature || entry.variationId}`);
        const slots = summarizePrSlots(entry.prs);
        for (const slot of slots.sort((a, b) => Number(b.normalizedOneRm || 0) - Number(a.normalizedOneRm || 0))) {
            console.log(' ', slot);
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
