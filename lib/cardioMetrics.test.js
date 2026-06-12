/**
 * Usage: node lib/cardioMetrics.test.js
 */
const assert = require('assert');
const {
    evaluateCardioPersonalRecord,
    computeCardioPrsFromSets,
    extractCardioMetrics,
} = require('./cardioMetrics');

const baseSet = (overrides = {}) => ({
    unit: 'cardio',
    value: 1800,
    date: new Date('2026-01-01'),
    cardio: {
        speedKmh: 8,
        distanceKm: 4,
        inclinePercent: 0,
    },
    ...overrides,
});

{
    const result = evaluateCardioPersonalRecord(baseSet(), [], []);
    assert.strictEqual(result.isPersonalRecord, 'NB');
}

{
    const history = [baseSet({ value: 1200, cardio: { speedKmh: 8, distanceKm: 2.7 } })];
    const result = evaluateCardioPersonalRecord(
        baseSet({ value: 1800, cardio: { speedKmh: 8, distanceKm: 4 } }),
        history,
        [],
    );
    assert.strictEqual(result.isPersonalRecord, 'PR');
}

{
    const history = [baseSet()];
    const result = evaluateCardioPersonalRecord(baseSet(), history, []);
    assert.strictEqual(result.isPersonalRecord, 'SB');
}

{
    const history = [baseSet({ value: 2400, cardio: { speedKmh: 10, distanceKm: 6.7 } })];
    const result = evaluateCardioPersonalRecord(
        baseSet({ value: 1200, cardio: { speedKmh: 6, distanceKm: 2 } }),
        history,
        [],
    );
    assert.strictEqual(result.isPersonalRecord, null);
}

{
    const sets = [
        baseSet({ _id: '1', value: 1200, date: new Date('2026-01-01'), cardio: { speedKmh: 8, distanceKm: 2.7 } }),
        baseSet({ _id: '2', value: 1800, date: new Date('2026-02-01'), cardio: { speedKmh: 9, distanceKm: 4.5 } }),
        baseSet({ _id: '3', value: 1500, date: new Date('2026-03-01'), cardio: { speedKmh: 10, distanceKm: 4.2 } }),
    ];
    const prs = computeCardioPrsFromSets(sets);
    assert.strictEqual(prs.Temps.cardio.value, 1800);
    assert.strictEqual(prs.Distance.cardio.cardio.distanceKm, 4.5);
    assert.strictEqual(prs.Vitesse.cardio.cardio.speedKmh, 10);
    assert.strictEqual(prs.Last.cardio._id, '3');
}

{
    const metrics = extractCardioMetrics({
        unit: 'cardio',
        value: 3600,
        cardio: { speedKmh: 10 },
    });
    assert.strictEqual(metrics.distanceKm, 10);
}

{
    const mongooseLikeSet = {
        _doc: {
            _id: 'mongo-1',
            unit: 'cardio',
            value: 1800,
            date: new Date('2026-06-09'),
            cardio: {
                distanceKm: 6,
                speedKmh: 12,
                elevationGainM: 1200,
            },
        },
    };
    const prs = computeCardioPrsFromSets([mongooseLikeSet]);
    const serialized = JSON.parse(JSON.stringify(prs.Last.cardio));
    assert.strictEqual(serialized.value, 1800);
    assert.strictEqual(serialized.cardio.distanceKm, 6);
    assert.strictEqual(serialized.cardio.speedKmh, 12);
    assert.strictEqual(serialized._doc, undefined);
}

console.log('cardioMetrics.test.js: all tests passed');
