/**
 * Tests unitaires légers — programTemplate (backend)
 * Usage: node lib/programTemplate.test.js
 */
const assert = require('assert');
const { buildProgramTemplateFromSeanceSets, countDistinctExercisesInSets } = require('./programTemplate');

const mockSets = [
    {
        exerciceOrder: 1,
        setOrder: 1,
        unit: 'repetitions',
        value: 10,
        weightLoad: 50,
        variations: [{ variation: '507f1f77bcf86cd799439011', name: { fr: 'Bench', en: 'Bench' } }],
        mergedVariationsNames: { fr: 'Bench', en: 'Bench' },
    },
    {
        exerciceOrder: 1,
        setOrder: 2,
        unit: 'repetitions',
        value: 8,
        weightLoad: 60,
        variations: [{ variation: '507f1f77bcf86cd799439011', name: { fr: 'Bench', en: 'Bench' } }],
        mergedVariationsNames: { fr: 'Bench', en: 'Bench' },
    },
];

const template = buildProgramTemplateFromSeanceSets(mockSets);
assert.strictEqual(template.length, 1);
assert.strictEqual(template[0].sets.length, 2);
assert.strictEqual(template[0].variationName.fr, 'Bench');
assert.strictEqual(template[0].mergedVariationsNames.en, 'Bench');
assert.strictEqual(countDistinctExercisesInSets(mockSets), 1);

console.log('programTemplate.test.js — OK');
