/**
 * ATH poids du corps : 16 reps @ 0 kg doit battre 15 reps @ 0 kg (1RM estimé avec PDC).
 * Usage: node oneShotQueries/testPrBodyweightAth.cjs
 */
const assert = require('assert');
const { resolvePrComparisonOneRmKg } = require('../utils/set');
const { computeSetOneRepMaxEstimates } = require('../utils/oneRepMax');

function makeBodyweightSet(reps, userWeightKg = 75, ratio = 1) {
    const weighted = userWeightKg * ratio;
    const withBw = computeSetOneRepMaxEstimates({
        unit: 'repetitions',
        value: reps,
        weightLoad: weighted,
        elastic: null,
    });
    return {
        unit: 'repetitions',
        value: reps,
        weightLoad: 0,
        effectiveWeightLoad: 0,
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: userWeightKg,
        oneRepMaxExerciseBodyWeightRatio: ratio,
        brzyckiWithBodyweight: withBw.brzycki,
        epleyWithBodyweight: withBw.epley,
        repsEquivalent: reps,
    };
}

(function testZeroKg16Beats15ForAth() {
    const set15 = makeBodyweightSet(15);
    const set16 = makeBodyweightSet(16);
    const oneRm15 = resolvePrComparisonOneRmKg(set15);
    const oneRm16 = resolvePrComparisonOneRmKg(set16);
    assert.ok(oneRm15 != null && oneRm16 != null, '1RM PDC doit être calculable');
    assert.ok(oneRm16 > oneRm15, `16 reps (${oneRm16}) doit battre 15 reps (${oneRm15})`);
    console.log('testZeroKg16Beats15ForAth — OK');
})();

console.log('testPrBodyweightAth.cjs — all OK');
