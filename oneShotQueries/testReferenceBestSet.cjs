/**
 * Deltas PR : uniquement vs historique au même nombre de reps / secondes.
 * Usage: node oneShotQueries/testReferenceBestSet.cjs
 */
const assert = require('assert');
const { getReferenceBestSetAtSameReps } = require('../lib/set');
const { getEffectiveLoadPreferringPersisted } = require('../utils/set');

(function test16at16Vs16at12() {
    const history = [
        { unit: 'repetitions', value: 9, weightLoad: 16, effectiveWeightLoad: 16 },
        { unit: 'repetitions', value: 16, weightLoad: 12, effectiveWeightLoad: 12 },
    ];

    const ref = getReferenceBestSetAtSameReps(history, 16);
    assert.strictEqual(ref.value, 16);
    assert.strictEqual(getEffectiveLoadPreferringPersisted(ref), 12);
    assert.strictEqual(16 - 12, 4);

    console.log('test16at16Vs16at12 — OK');
})();

(function testIgnoresOtherRepCounts() {
    const history = [
        { unit: 'repetitions', value: 9, weightLoad: 16, effectiveWeightLoad: 16 },
        { unit: 'repetitions', value: 15, weightLoad: 17.5, effectiveWeightLoad: 17.5 },
        { unit: 'repetitions', value: 16, weightLoad: 12, effectiveWeightLoad: 12 },
    ];

    const ref = getReferenceBestSetAtSameReps(history, 16);
    assert.strictEqual(getEffectiveLoadPreferringPersisted(ref), 12);

    console.log('testIgnoresOtherRepCounts — OK');
})();

console.log('testReferenceBestSet.cjs — all OK');
