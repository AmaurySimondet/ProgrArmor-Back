/**
 * Tests comparaison PR / best set via 1RM agrégé + sémantique isPr.
 * Usage: node oneShotQueries/testPrComparisonOneRm.cjs
 */
const assert = require('assert');
const {
    compareAndAssignPR,
    filterSetsAtSameEffectiveLoad,
    filterSetsAtSameValue,
    getReferenceBestSetAtSameLoad,
    maxEffectiveLoadAmongSets,
    maxValueAmongSets,
    resolvePrComparisonOneRmKg,
    LOAD_EPSILON,
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

(function testNegativeEffectiveLoadPeakAtSameLoad() {
    const makeAssistanceSet = (value, id) => ({
        unit: 'repetitions',
        value,
        weightLoad: 0,
        effectiveWeightLoad: -10,
        elastic: { use: 'assistance', tension: 10, type: 'band' },
        _id: id,
    });
    const history = [makeAssistanceSet(10, 'h1'), makeAssistanceSet(12, 'h2')];
    const atSameLoad = filterSetsAtSameEffectiveLoad(history, -10);
    assert.strictEqual(maxValueAmongSets(atSameLoad), 12);
    assert.ok(
        10 < maxValueAmongSets(atSameLoad),
        '10 reps below peak 12 at same -10kg effective load → no badge',
    );
    console.log('negative effective load peak at same load — OK');
})();

(function testMaxEffectiveLoadIgnoresNonFinite() {
    const history = [
        { value: 10, weightLoad: 50, effectiveWeightLoad: 50 },
        { value: 10, weightLoad: NaN, effectiveWeightLoad: NaN },
        { value: 10, effectiveWeightLoad: 'bad' },
    ];
    assert.strictEqual(maxEffectiveLoadAmongSets(history), 50);

    assert.strictEqual(
        maxEffectiveLoadAmongSets([{ value: 10, weightLoad: NaN, effectiveWeightLoad: NaN }]),
        null,
    );
    assert.strictEqual(maxEffectiveLoadAmongSets([]), null);

    const maxLoadAtValue = maxEffectiveLoadAmongSets(history.filter((s) => s.value === 10));
    assert.strictEqual(maxLoadAtValue, 50);
    assert.ok(Number.isFinite(maxLoadAtValue));
    assert.ok(55 > maxLoadAtValue + LOAD_EPSILON);
    assert.ok(Math.abs(50 - maxLoadAtValue) <= LOAD_EPSILON);
    console.log('maxEffectiveLoadAmongSets ignores non-finite — OK');
})();

(function testSameLoadHelpers() {
    const history = [
        makeRepSet(3, 0, { _id: 'a' }),
        makeRepSet(1, 20, { _id: 'b' }),
    ];
    const atZero = filterSetsAtSameEffectiveLoad(history, 0);
    assert.strictEqual(atZero.length, 1);
    assert.strictEqual(maxValueAmongSets(atZero), 3);
    assert.strictEqual(getReferenceBestSetAtSameLoad(history, 0).value, 3);
    console.log('same-load PR helpers — OK');
})();

(function testIsPrSemantics() {
    const evaluateStatus = ({
        allSets,
        unit = 'repetitions',
        value,
        weightLoad,
    }) => {
        if (unit === 'repetitions' && Number(value) === 0) return null;
        const currentSet = withNormalizedOneRm(makeRepSet(value, weightLoad));
        const currentEffectiveLoad = weightLoad;
        const currentOneRm = resolvePrComparisonOneRmKg(currentSet);
        const currentValue = Number(value);

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

        if (isAth) return 'ATH';

        const setsAtSameLoad = filterSetsAtSameEffectiveLoad(
            sameUnitSets,
            currentEffectiveLoad,
        );
        const setsAtSameValue = filterSetsAtSameValue(sameUnitSets, currentValue);
        const maxValueAtSameLoad = maxValueAmongSets(setsAtSameLoad);
        const maxLoadAtSameValue = maxEffectiveLoadAmongSets(setsAtSameValue);
        const hasHistoryAtLoad = setsAtSameLoad.length > 0;
        const hasHistoryAtValue = setsAtSameValue.length > 0;

        if (!hasHistoryAtLoad && !hasHistoryAtValue) return 'NB';

        const beatsValue = maxValueAtSameLoad != null
            && Number.isFinite(currentValue)
            && currentValue > maxValueAtSameLoad;
        const beatsLoad = maxLoadAtSameValue != null
            && currentEffectiveLoad > maxLoadAtSameValue + LOAD_EPSILON;
        const tiesValue = maxValueAtSameLoad != null
            && Number.isFinite(currentValue)
            && currentValue === maxValueAtSameLoad;
        const tiesLoad = maxLoadAtSameValue != null
            && Math.abs(currentEffectiveLoad - maxLoadAtSameValue) <= LOAD_EPSILON;

        if (beatsValue || beatsLoad) return 'PR';
        if (tiesValue && tiesLoad) return 'SB';
        return null;
    };

    assert.strictEqual(evaluateStatus({ allSets: [], value: 10, weightLoad: 20 }), 'NB');
    assert.strictEqual(
        evaluateStatus({ allSets: [], value: 0, weightLoad: 20 }),
        null,
        '0 reps should never grant NB/new best when there is no history',
    );

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

    const pdcHistory = [
        withNormalizedOneRm(makeRepSet(3, 0, { _id: 'pdc3' })),
        withNormalizedOneRm(makeRepSet(1, 20, { _id: 'heavy1' })),
    ];
    assert.strictEqual(
        evaluateStatus({ allSets: pdcHistory, value: 12, weightLoad: 0 }),
        'PR',
        '12@0kg should be PR vs best 3@0kg even when 1@20kg blocks ATH',
    );

    assert.strictEqual(
        evaluateStatus({ allSets: pdcHistory, value: 2, weightLoad: 0 }),
        null,
        '2@0kg below best 3@0kg at same load is not PR nor NB',
    );

    const loadedHistory = [
        withNormalizedOneRm(makeRepSet(10, 50, { _id: 'ten' })),
        withNormalizedOneRm(makeRepSet(1, 100, { _id: 'heavy' })),
    ];
    assert.strictEqual(
        evaluateStatus({ allSets: loadedHistory, value: 12, weightLoad: 50 }),
        'PR',
        'more reps at same load (50kg) is PR when ATH blocked by heavier low-rep set',
    );

    assert.strictEqual(
        evaluateStatus({
            allSets: [withNormalizedOneRm(makeRepSet(20, 20, { _id: 'twenty' }))],
            value: 12,
            weightLoad: 20,
        }),
        null,
        '12@20kg below best 20@20kg at same load: no badge, not NB',
    );

    assert.strictEqual(
        evaluateStatus({
            allSets: [withNormalizedOneRm(makeRepSet(20, 20))],
            value: 8,
            weightLoad: 25,
        }),
        'NB',
        'first time at 25kg with no same-load history stays NB',
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

    const peakAt50History = [
        withNormalizedOneRm(makeRepSet(10, 50, { _id: 'ten' })),
        withNormalizedOneRm(makeRepSet(12, 50, { _id: 'twelve' })),
    ];
    assert.strictEqual(
        evaluateStatus({ allSets: peakAt50History, value: 10, weightLoad: 50 }),
        null,
        '10@50kg below peak 12@50kg: no badge even if 10 was done before',
    );

    const tuckHoldHistory = [
        { unit: 'seconds', value: 15, weightLoad: 0, effectiveWeightLoad: 0, _id: 's15' },
        { unit: 'seconds', value: 25, weightLoad: 0, effectiveWeightLoad: 0, _id: 's25' },
        { unit: 'seconds', value: 20, weightLoad: 0, effectiveWeightLoad: 0, _id: 's20' },
    ];
    assert.strictEqual(
        evaluateStatus({
            allSets: tuckHoldHistory,
            unit: 'seconds',
            value: 20,
            weightLoad: 0,
        }),
        null,
        '20s@0kg below peak 25s: no badge even if 20s was done before',
    );
    assert.strictEqual(
        evaluateStatus({
            allSets: tuckHoldHistory,
            unit: 'seconds',
            value: 26,
            weightLoad: 0,
        }),
        'PR',
        '26s@0kg beats peak 25s',
    );
    assert.strictEqual(
        evaluateStatus({
            allSets: tuckHoldHistory,
            unit: 'seconds',
            value: 25,
            weightLoad: 0,
        }),
        'SB',
        '25s@0kg ties peak',
    );

    const dcHistory = [withNormalizedOneRm(makeRepSet(1, 95.5, { _id: 'max' }))];
    assert.strictEqual(
        evaluateStatus({ allSets: dcHistory, value: 1, weightLoad: 90 }),
        null,
        '1@90kg below best load at 1 rep (95.5kg): no badge',
    );
    assert.strictEqual(
        evaluateStatus({ allSets: dcHistory, value: 1, weightLoad: 95.5 }),
        'SB',
        '1@95.5kg ties record at 1 rep',
    );

    const eightRepHistory = [
        withNormalizedOneRm(makeRepSet(8, 40, { _id: 'eight40' })),
        withNormalizedOneRm(makeRepSet(10, 50, { _id: 'ten50' })),
    ];
    assert.strictEqual(
        evaluateStatus({ allSets: eightRepHistory, value: 8, weightLoad: 50 }),
        'PR',
        '8@50kg beats best load at 8 reps (40kg) when ATH blocked by 10@50',
    );
    assert.strictEqual(
        evaluateStatus({ allSets: [eightRepHistory[0]], value: 8, weightLoad: 50 }),
        'ATH',
        '8@50kg vs only 8@40 can be ATH when 1RM beats',
    );

    const threeRepAt10 = [withNormalizedOneRm(makeRepSet(3, 10, { _id: 'three' }))];
    assert.strictEqual(
        evaluateStatus({ allSets: threeRepAt10, value: 2, weightLoad: 10 }),
        null,
        '2@10kg below peak 3@10kg',
    );

    console.log('isPr semantics ATH/PR/SB/NB — OK');
})();

(function testOneRmTieUsesLoadEpsilon() {
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
