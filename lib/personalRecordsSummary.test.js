/**
 * Usage: node lib/personalRecordsSummary.test.js
 */
const assert = require('assert');
const {
    getVariationSignature,
    averagePopularityForVariations,
    resolvePersonalRecordSortWeightLoadKg,
    normalizeAndMergeExerciseGroups,
    sortExerciseGroupsByCountStable,
    sortPersonalRecordSummaries,
    getSetVariationSignature,
    indexSetsByVariationSignature,
    collectSetsMatchingVariationGroups,
} = require('./personalRecordsSummaryHelpers');

{
    const sigAB = getVariationSignature(['b', 'a']);
    const sigBA = getVariationSignature(['a', 'b']);
    assert.strictEqual(sigAB, sigBA);
    assert.strictEqual(sigAB, 'a|b');
}

{
    const merged = normalizeAndMergeExerciseGroups([
        {
            _id: ['verified1'],
            count: 3,
            variations: [{ _id: 'verified1', verified: true, popularity: 50 }],
        },
        {
            _id: ['verified1'],
            count: 2,
            variations: [{ _id: 'verified1', verified: true, popularity: 50 }],
        },
    ]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].count, 5);
}

{
    const merged = normalizeAndMergeExerciseGroups([
        {
            _id: ['a', 'b'],
            count: 4,
            variations: [{ popularity: 10 }, { popularity: 20 }],
        },
        {
            _id: ['b', 'a'],
            count: 6,
            variations: [{ popularity: 10 }, { popularity: 20 }],
        },
    ]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].count, 10);
}

{
    const avg = averagePopularityForVariations([
        { popularity: 10 },
        { popularity: null },
        { popularity: 20 },
    ]);
    assert.strictEqual(avg, 15);
}

{
    const avg = averagePopularityForVariations([
        { popularity: null },
        { popularity: { global: null } },
    ]);
    assert.strictEqual(avg, 0);
}

{
    const avg = averagePopularityForVariations([
        { popularity: { global: 12 } },
        { popularity: 8 },
    ]);
    assert.strictEqual(avg, 10);
}

{
    const load = resolvePersonalRecordSortWeightLoadKg({
        ATH: { repetitions: { effectiveWeightLoad: 80 } },
        Best: { effectiveWeightLoad: 100 },
    });
    assert.strictEqual(load, 80);
}

{
    const load = resolvePersonalRecordSortWeightLoadKg({
        ATH: { repetitions: null, seconds: null },
        Best: { effectiveWeightLoad: 100 },
    });
    assert.strictEqual(load, 100);
}

{
    const load = resolvePersonalRecordSortWeightLoadKg({
        ATH: {
            repetitions: { effectiveWeightLoad: 70 },
            seconds: { effectiveWeightLoad: 90 },
        },
        Best: { effectiveWeightLoad: 100 },
    });
    assert.strictEqual(load, 90);
}

{
    const sorted = sortPersonalRecordSummaries([
        {
            variationIds: ['low'],
            variations: [{ popularity: 10 }],
            prs: { Best: { effectiveWeightLoad: 50 } },
        },
        {
            variationIds: ['high'],
            variations: [{ popularity: 20 }],
            prs: { Best: { effectiveWeightLoad: 10 } },
        },
    ]);
    assert.strictEqual(sorted[0].variationIds[0], 'high');
    assert.strictEqual(sorted[1].variationIds[0], 'low');
}

{
    const sorted = sortPersonalRecordSummaries([
        {
            variationIds: ['b'],
            variations: [{ popularity: 10 }],
            prs: { Best: { effectiveWeightLoad: 50 } },
        },
        {
            variationIds: ['a'],
            variations: [{ popularity: 10 }],
            prs: { Best: { effectiveWeightLoad: 100 } },
        },
    ]);
    assert.strictEqual(sorted[0].variationIds[0], 'a');
    assert.strictEqual(sorted[1].variationIds[0], 'b');
}

{
    const sorted = sortPersonalRecordSummaries([
        {
            variationIds: ['z'],
            variations: [{ popularity: 10 }],
            prs: { Best: { effectiveWeightLoad: 100 } },
        },
        {
            variationIds: ['a'],
            variations: [{ popularity: 10 }],
            prs: { Best: { effectiveWeightLoad: 100 } },
        },
    ]);
    assert.strictEqual(sorted[0].variationIds[0], 'a');
    assert.strictEqual(sorted[1].variationIds[0], 'z');
}

{
    const sorted = sortExerciseGroupsByCountStable([
        { _id: ['b'], count: 5 },
        { _id: ['a'], count: 5 },
        { _id: ['c'], count: 10 },
    ]);
    assert.deepStrictEqual(sorted.map((group) => group._id[0]), ['c', 'a', 'b']);
}

{
    const index = indexSetsByVariationSignature([
        { _id: '1', date: new Date('2026-01-02'), variations: [{ variation: 'b' }, { variation: 'a' }] },
        { _id: '2', date: new Date('2026-01-01'), variations: [{ variation: 'a' }, { variation: 'b' }] },
        { _id: '3', date: new Date('2026-01-03'), variations: [{ variation: 'c' }] },
    ]);
    assert.strictEqual(index.get('a|b')?.length, 2);
    assert.strictEqual(index.get('a|b')[0]._id, '2');
    assert.strictEqual(index.get('a|b')[1]._id, '1');
}

{
    const index = indexSetsByVariationSignature([
        { _id: '1', date: new Date('2026-01-01'), variations: [{ variation: 'verified1' }] },
        { _id: '2', date: new Date('2026-01-02'), variations: [{ variation: 'a' }, { variation: 'b' }] },
    ]);
    const sets = collectSetsMatchingVariationGroups(index, [['a', 'b'], ['verified1']]);
    assert.deepStrictEqual(sets.map((set) => set._id), ['1', '2']);
}

console.log('personalRecordsSummary.test.js: all tests passed');
