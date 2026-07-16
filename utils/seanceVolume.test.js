/**
 * Usage: node utils/seanceVolume.test.js
 */
const assert = require('assert');
const {
    sumSeanceTotalWeightKg,
    seanceTotalWeightKgMongoSum,
} = require('./seanceVolume');

assert.strictEqual(
    sumSeanceTotalWeightKg([
        { stats: { totalWeight: 100 } },
        { stats: { totalWeight: 250.5 } },
        { stats: { totalWeight: null } },
        { stats: {} },
        {},
        { stats: { totalWeight: '10' } },
    ]),
    360.5,
);
assert.strictEqual(sumSeanceTotalWeightKg([]), 0);
assert.strictEqual(sumSeanceTotalWeightKg(null), 0);
assert.strictEqual(sumSeanceTotalWeightKg(undefined), 0);

assert.deepStrictEqual(seanceTotalWeightKgMongoSum(), {
    $sum: { $ifNull: ['$stats.totalWeight', 0] },
});

console.log('seanceVolume.test.js: all tests passed');
