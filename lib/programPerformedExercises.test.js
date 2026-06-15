/**
 * Tests unitaires légers — programPerformedExercises
 * Usage: node lib/programPerformedExercises.test.js
 */
const assert = require('assert');
const {
    collectPerformedExercisesFromSeances,
    groupSetsBySeanceId,
    MAX_EXERCISES,
} = require('./programPerformedExercises');

const benchId = '507f1f77bcf86cd799439011';
const squatId = '507f1f77bcf86cd799439012';

const seanceRecent = { _id: 'seance1', date: new Date('2026-06-10') };
const seanceOlder = { _id: 'seance2', date: new Date('2026-06-01') };

const benchSets = [
    {
        seance: 'seance1',
        exerciceOrder: 1,
        setOrder: 1,
        unit: 'repetitions',
        value: 10,
        weightLoad: 50,
        variations: [{ variation: benchId, name: { fr: 'Bench', en: 'Bench' } }],
        mergedVariationsNames: { fr: 'Bench', en: 'Bench' },
    },
];

const squatSets = [
    {
        seance: 'seance2',
        exerciceOrder: 1,
        setOrder: 1,
        unit: 'repetitions',
        value: 5,
        weightLoad: 100,
        variations: [{ variation: squatId, name: { fr: 'Squat', en: 'Squat' } }],
        mergedVariationsNames: { fr: 'Squat', en: 'Squat' },
    },
];

const setsBySeanceId = groupSetsBySeanceId([...benchSets, ...squatSets]);

const exercises = collectPerformedExercisesFromSeances(
    [seanceRecent, seanceOlder],
    setsBySeanceId,
);

assert.strictEqual(exercises.length, 2);
assert.strictEqual(exercises[0].variationIds[0], benchId);
assert.strictEqual(exercises[0].lastPerformedAt, seanceRecent.date);
assert.strictEqual(exercises[1].variationIds[0], squatId);

const deduped = collectPerformedExercisesFromSeances(
    [seanceRecent, seanceOlder],
    groupSetsBySeanceId([
        ...benchSets,
        {
            ...benchSets[0],
            seance: 'seance2',
            value: 8,
        },
    ]),
);

assert.strictEqual(deduped.length, 1);
assert.strictEqual(deduped[0].variationIds[0], benchId);
assert.strictEqual(deduped[0].lastPerformedAt, seanceRecent.date);

const capped = collectPerformedExercisesFromSeances(
    [seanceRecent, seanceOlder],
    setsBySeanceId,
    1,
);

assert.strictEqual(capped.length, 1);
assert.strictEqual(capped[0].variationIds[0], benchId);
assert.strictEqual(MAX_EXERCISES, 30);

console.log('programPerformedExercises.test.js — OK');
