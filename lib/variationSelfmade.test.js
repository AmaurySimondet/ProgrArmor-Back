/**
 * Tests unitaires — variationSelfmade
 * Usage: node lib/variationSelfmade.test.js
 */
const assert = require('assert');
const mongoose = require('mongoose');
const {
    DEFAULT_BODYWEIGHT_RATIO,
    buildSelfmadeCreatePayload,
    hasNormalizedNameConflict,
} = require('./variationSelfmade');
const {
    buildSelfmadeVisibilityFilter,
    mergeQueryWithSelfmadeVisibility,
    isVariationVisibleToUser,
} = require('./variationSearchPipelines');

const userId = '507f1f77bcf86cd799439011';

assert.strictEqual(DEFAULT_BODYWEIGHT_RATIO, 0.8);

const exercisePayload = buildSelfmadeCreatePayload({
    name: { fr: 'Pompes', en: 'Pompes' },
    type: '507f1f77bcf86cd799439012',
    isExercice: true,
    isUnilateral: true,
    includeBodyweight: true,
});
assert.strictEqual(exercisePayload.isExercice, true);
assert.strictEqual(exercisePayload.selfmade, true);
assert.strictEqual(exercisePayload.verified, false);
assert.strictEqual(exercisePayload.isUnilateral, true);
assert.strictEqual(exercisePayload.includeBodyweight, true);
assert.strictEqual(exercisePayload.exerciseBodyWeightRatio, 0.8);
assert.strictEqual(exercisePayload.normalizedName.fr, 'pompes');

const detailPayload = buildSelfmadeCreatePayload({
    name: { fr: 'Prise serrée', en: 'Prise serrée' },
    type: '507f1f77bcf86cd799439012',
    isExercice: false,
    isUnilateral: true,
    includeBodyweight: true,
});
assert.strictEqual(detailPayload.isExercice, false);
assert.strictEqual(detailPayload.isUnilateral, false);
assert.strictEqual(detailPayload.includeBodyweight, false);
assert.strictEqual(detailPayload.exerciseBodyWeightRatio, undefined);
assert.deepStrictEqual(detailPayload.popularity, {
    global: 0,
    bodyweight_plus_external: 0,
    external_free: 0,
    external_machine: 0,
});

assert.strictEqual(
    hasNormalizedNameConflict(
        { fr: 'Pompes', en: 'Push-ups' },
        true,
        [{ isExercice: true, normalizedName: { fr: 'pompes', en: 'push ups' } }]
    ),
    true
);
assert.strictEqual(
    hasNormalizedNameConflict(
        { fr: 'Pompes', en: 'Push-ups' },
        false,
        [{ isExercice: true, normalizedName: { fr: 'pompes', en: 'push ups' } }]
    ),
    false
);
assert.strictEqual(
    hasNormalizedNameConflict(
        { fr: 'Pompes', en: 'Pompes' },
        true,
        [{ isExercice: true, normalizedName: { fr: 'squat', en: 'squat' } }]
    ),
    false
);

assert.deepStrictEqual(buildSelfmadeVisibilityFilter(null), { selfmade: false });
const withUserFilter = buildSelfmadeVisibilityFilter(userId);
assert.ok(Array.isArray(withUserFilter.$or));
assert.strictEqual(withUserFilter.$or[0].selfmade, false);
assert.ok(withUserFilter.$or[1].madeByUser instanceof mongoose.Types.ObjectId);

const merged = mergeQueryWithSelfmadeVisibility({ isExercice: true }, userId);
assert.ok(Array.isArray(merged.$and));
assert.deepStrictEqual(merged.$and[0], { isExercice: true });

assert.strictEqual(isVariationVisibleToUser({ selfmade: false }, userId), true);
assert.strictEqual(
    isVariationVisibleToUser({ selfmade: true, madeByUser: userId }, userId),
    true
);
assert.strictEqual(
    isVariationVisibleToUser({ selfmade: true, madeByUser: '507f1f77bcf86cd799439099' }, userId),
    false
);
assert.strictEqual(isVariationVisibleToUser({ selfmade: true, madeByUser: userId }, null), false);

console.log('variationSelfmade.test.js: all tests passed');
