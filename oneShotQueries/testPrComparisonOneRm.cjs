/**
 * Tests comparaison PR / best set via 1RM agrégé + sémantique isPr.
 * Usage: node oneShotQueries/testPrComparisonOneRm.cjs
 */
const assert = require('assert');
const {
    compareAndAssignPR,
    resolvePrComparisonOneRmKg,
} = require('../utils/set');
const {
    computeSetOneRepMaxEstimates,
    resolveAggregateNormalizedOneRm,
    getTrainingRepsEquivalent,
} = require('../utils/oneRepMax');

const makeRepSet = (value, weightLoad, extra = {}) => ({
    unit: 'repetitions',
    value,
    weightLoad,
    effectiveWeightLoad: weightLoad,
    ...extra,
});

const withNormalizedOneRm = (set) => {
    const repsEquivalent = getTrainingRepsEquivalent(set);
    const estimates = computeSetOneRepMaxEstimates(set);
    const normalizedOneRm = resolveAggregateNormalizedOneRm(
        estimates.brzycki,
        estimates.epley,
        repsEquivalent,
        set.effectiveWeightLoad,
    );
    return { ...set, repsEquivalent, ...estimates, normalizedOneRm };
};

(function testCompareAndAssignPR() {
    const set12x16 = withNormalizedOneRm(makeRepSet(12, 16));
    const set19x15 = withNormalizedOneRm(makeRepSet(19, 15));

    const oneRm12 = resolvePrComparisonOneRmKg(set12x16);
    const oneRm19 = resolvePrComparisonOneRmKg(set19x15);
    assert.ok(oneRm19 > oneRm12, `19@15 (${oneRm19}) should beat 12@16 (${oneRm12})`);

    const winner = compareAndAssignPR(set12x16, set19x15);
    assert.strictEqual(winner.value, 19);
    assert.strictEqual(winner.weightLoad, 15);

    console.log('compareAndAssignPR 12@16 vs 19@15 — OK');
})();

(function testAthCategory() {
    const sets = [
        withNormalizedOneRm(makeRepSet(12, 16, { _id: 'a' })),
        withNormalizedOneRm(makeRepSet(19, 15, { _id: 'b' })),
    ];

    let ath = null;
    for (const set of sets) {
        ath = compareAndAssignPR(ath, set);
    }
    assert.strictEqual(ath._id, 'b');
    console.log('ATH category selection — OK');
})();

(function testIsPrSemantics() {
    const LOAD_EPSILON = 0.001;

    const evaluateStatus = ({
        allSets,
        unit = 'repetitions',
        value,
        weightLoad,
    }) => {
        const currentSet = withNormalizedOneRm(makeRepSet(value, weightLoad));
        const currentEffectiveLoad = weightLoad;
        const currentOneRm = resolvePrComparisonOneRmKg(currentSet);

        if (allSets.length === 0) return 'NB';

        const sameUnitSets = allSets.filter((s) => s.unit === unit);
        let maxHistoricalOneRm = null;
        for (const historicalSet of sameUnitSets) {
            const historicalOneRm = resolvePrComparisonOneRmKg(historicalSet);
            if (historicalOneRm != null
                && (maxHistoricalOneRm == null || historicalOneRm > maxHistoricalOneRm)) {
                maxHistoricalOneRm = historicalOneRm;
            }
        }

        const isAth = currentOneRm != null
            && maxHistoricalOneRm != null
            && currentOneRm > maxHistoricalOneRm;

        const setsSameValue = sameUnitSets.filter((s) => s.value === value);
        const hasSameValueHistory = setsSameValue.length > 0;

        if (isAth) return 'ATH';
        if (!hasSameValueHistory) return 'NB';

        const maxLoadAtValue = setsSameValue.reduce(
            (max, s) => Math.max(max, s.effectiveWeightLoad),
            0,
        );
        if (currentEffectiveLoad > maxLoadAtValue + LOAD_EPSILON) return 'PR';
        if (Math.abs(currentEffectiveLoad - maxLoadAtValue) <= LOAD_EPSILON) return 'SB';
        return null;
    };

    assert.strictEqual(evaluateStatus({ allSets: [], value: 10, weightLoad: 20 }), 'NB');

    const history = [withNormalizedOneRm(makeRepSet(19, 14, { _id: 'h1' }))];
    assert.strictEqual(
        evaluateStatus({ allSets: history, value: 19, weightLoad: 15 }),
        'ATH',
    );

    const historyWith19 = [
        withNormalizedOneRm(makeRepSet(19, 14, { _id: 'h1' })),
        withNormalizedOneRm(makeRepSet(12, 16, { _id: 'h2' })),
    ];
    assert.strictEqual(
        evaluateStatus({ allSets: historyWith19, value: 19, weightLoad: 15 }),
        'ATH',
    );

    assert.strictEqual(
        evaluateStatus({ allSets: historyWith19, value: 20, weightLoad: 10 }),
        'NB',
    );

    const history19at15 = [withNormalizedOneRm(makeRepSet(19, 15, { _id: 'dup' }))];
    assert.strictEqual(
        evaluateStatus({ allSets: history19at15, value: 19, weightLoad: 15 }),
        'SB',
    );

    const history19at14only = [withNormalizedOneRm(makeRepSet(19, 14, { _id: 'h1' }))];
    assert.strictEqual(
        evaluateStatus({ allSets: history19at14only, value: 19, weightLoad: 15 }),
        'ATH',
    );

    console.log('isPr semantics ATH/PR/SB/NB — OK');
})();

(function testOneRmTieUsesLoadEpsilon() {
    const { LOAD_EPSILON } = require('../utils/set');
    const sharedOneRm = 62.5;
    const base = {
        unit: 'repetitions',
        value: 10,
        weightLoad: 50,
        effectiveWeightLoad: 50,
        normalizedOneRm: sharedOneRm,
    };
    const slightlyHeavier = {
        ...base,
        weightLoad: 50 + LOAD_EPSILON * 2,
        effectiveWeightLoad: 50 + LOAD_EPSILON * 2,
    };
    const winner = compareAndAssignPR(base, slightlyHeavier);
    assert.strictEqual(winner.weightLoad, slightlyHeavier.weightLoad);
    console.log('oneRm tie-break via LOAD_EPSILON — OK');
})();

(function testBodyweightZeroExternalLoadOneRm() {
    const set = {
        unit: 'repetitions',
        value: 8,
        weightLoad: 0,
        effectiveWeightLoad: 0,
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: 80,
        oneRepMaxExerciseBodyWeightRatio: 1,
        brzyckiWithBodyweight: 95,
        epleyWithBodyweight: 98,
    };
    const oneRm = resolvePrComparisonOneRmKg(set);
    assert.ok(oneRm != null && oneRm > 0, 'bodyweight 1RM must be positive at 0 kg external');
    console.log('bodyweight 0 kg external 1RM — OK');
})();

console.log('testPrComparisonOneRm.cjs — all OK');
