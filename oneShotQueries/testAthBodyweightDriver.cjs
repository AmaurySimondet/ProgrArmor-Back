/**
 * ATH « PDC différent » : recalcul 1RM au poids du pic (même reps ou moins de reps que le pic).
 * Usage: node oneShotQueries/testAthBodyweightDriver.cjs
 */
const assert = require('assert');
const { resolvePrComparisonOneRmKg } = require('../utils/set');

// Copie minimale de la logique lib/set (non exportée) pour test unitaire
const { computeSetOneRepMaxEstimates } = require('../utils/oneRepMax');
const { getEffectiveLoadKg } = require('../utils/oneRepMax');
const { round2 } = require('../utils/seanceSetPersistedFields');
const LOAD_EPSILON = 0.001;

function computeOneRmAtUserBodyweight(setLike, userWeightKg, exerciseBodyWeightRatio) {
    const ratio = exerciseBodyWeightRatio > 0 ? exerciseBodyWeightRatio : 1;
    const weighted = round2(userWeightKg * ratio);
    const externalLoad = getEffectiveLoadKg(setLike, { includeBodyweight: false });
    const totalLoad = round2(externalLoad + weighted);
    const estimates = computeSetOneRepMaxEstimates({
        unit: setLike.unit,
        value: setLike.value,
        weightLoad: totalLoad,
        effectiveWeightLoad: totalLoad,
        elastic: null,
    });
    return resolvePrComparisonOneRmKg({
        unit: setLike.unit,
        value: setLike.value,
        weightLoad: 0,
        effectiveWeightLoad: 0,
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: userWeightKg,
        oneRepMaxExerciseBodyWeightRatio: ratio,
        brzyckiWithBodyweight: estimates.brzycki,
        epleyWithBodyweight: estimates.epley,
    });
}

(function test15reps88vs89() {
    const ratio = 0.9;
    const peakSet = {
        unit: 'repetitions',
        value: 15,
        weightLoad: 0,
        effectiveWeightLoad: 0,
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: 88,
        oneRepMaxExerciseBodyWeightRatio: ratio,
        epleyWithBodyweight: 118.8,
    };
    const maxReferenceOneRm = resolvePrComparisonOneRmKg(peakSet);
    const current = { unit: 'repetitions', value: 15, weightLoad: 0, elastic: null };
    const currentOneRm = computeOneRmAtUserBodyweight(current, 89, ratio);
    const atPeakWeight = computeOneRmAtUserBodyweight(current, 88, ratio);

    assert.ok(currentOneRm > maxReferenceOneRm);
    assert.ok(atPeakWeight <= maxReferenceOneRm + LOAD_EPSILON);
    assert.ok(currentOneRm > atPeakWeight);
    console.log('test15reps88vs89 — OK', { maxReferenceOneRm, currentOneRm, atPeakWeight });
})();

(function test14repsVsPeak15() {
    const ratio = 0.9;
    const peakSet = {
        unit: 'repetitions',
        value: 15,
        weightLoad: 0,
        effectiveWeightLoad: 0,
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: 88,
        oneRepMaxExerciseBodyWeightRatio: ratio,
        epleyWithBodyweight: 118.8,
    };
    const maxReferenceOneRm = resolvePrComparisonOneRmKg(peakSet);
    const current = { unit: 'repetitions', value: 14, weightLoad: 0, elastic: null };
    const currentOneRm = computeOneRmAtUserBodyweight(current, 89, ratio);
    const atPeakWeight = computeOneRmAtUserBodyweight(current, 88, ratio);

    assert.ok(currentOneRm > maxReferenceOneRm, '14@89 est ATH vs pic 15@88');
    assert.ok(atPeakWeight > maxReferenceOneRm + LOAD_EPSILON,
        '14@88 bat déjà le pic (courbe 1RM) — note PDC via règle « moins de reps »');
    assert.ok(currentOneRm > atPeakWeight, 'le +1 kg corps augmente encore le 1RM');
    console.log('test14repsVsPeak15 — OK', { maxReferenceOneRm, currentOneRm, atPeakWeight });
})();

(function test16repsNotBodyweightOnly() {
    const ratio = 0.9;
    const peakSet = {
        unit: 'repetitions',
        value: 15,
        weightLoad: 0,
        effectiveWeightLoad: 0,
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: 88,
        oneRepMaxExerciseBodyWeightRatio: ratio,
        epleyWithBodyweight: 118.8,
    };
    const maxReferenceOneRm = resolvePrComparisonOneRmKg(peakSet);
    const current = { unit: 'repetitions', value: 16, weightLoad: 0, elastic: null };
    const atPeakWeight = computeOneRmAtUserBodyweight(current, 88, ratio);

    assert.ok(atPeakWeight > maxReferenceOneRm + LOAD_EPSILON, '16@0 à 88 kg bat déjà le pic → pas note PDC seule');
    console.log('test16repsNotBodyweightOnly — OK', { maxReferenceOneRm, atPeakWeight });
})();

console.log('testAthBodyweightDriver.cjs — all OK');
