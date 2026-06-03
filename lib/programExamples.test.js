/**
 * Tests unitaires — programExamples
 * Usage: node lib/programExamples.test.js
 */
const assert = require('assert');
const {
    PROGRAM_EXAMPLES,
    buildExampleSets,
    buildProgramExerciseFromVariation,
    clearResolvedProgramCache,
    getExampleDefinition,
    getExerciseCount,
    resolveProgramTemplateForDefinition,
} = require('./programExamples');

assert.strictEqual(PROGRAM_EXAMPLES.length, 9);
assert.strictEqual(buildExampleSets().length, 4);
assert.strictEqual(buildExampleSets()[0].value, 12);
assert.strictEqual(buildExampleSets()[0].weightLoad, 0);
assert.strictEqual(buildExampleSets()[0].unit, 'repetitions');

const mockVariation = {
    _id: '507f1f77bcf86cd799439011',
    name: { fr: 'Squat barre', en: 'Barbell squat' },
};
const exercise = buildProgramExerciseFromVariation(mockVariation);
assert.strictEqual(exercise.variationIds[0], mockVariation._id);
assert.strictEqual(exercise.sets.length, 4);

assert.throws(() => getExampleDefinition('unknown'), /Unknown program example/);

clearResolvedProgramCache();

(async () => {
    const def = getExampleDefinition('push');
    const mockSearch = async (query) => {
        if (query.includes('couché')) {
            return { variations: [{ _id: 'a1', name: { fr: 'DC', en: 'BP' } }], total: 1 };
        }
        return { variations: [{ _id: 'a2', name: { fr: query, en: query } }], total: 1 };
    };

    const program = await resolveProgramTemplateForDefinition(def, {
        searchFn: mockSearch,
        getByIdFn: async (variationId) => ({
            _id: variationId,
            name: { fr: 'ID fixe', en: 'Fixed id' },
        }),
    });
    assert.strictEqual(program.length, getExerciseCount(def));
    program.forEach((entry) => {
        assert.strictEqual(entry.sets.length, 4);
        assert.strictEqual(entry.sets[0].value, 12);
    });

    const cached = await resolveProgramTemplateForDefinition(def, {
        searchFn: async () => {
            throw new Error('Should use cache');
        },
    });
    assert.strictEqual(cached.length, program.length);

    clearResolvedProgramCache();
    console.log('programExamples.test.js — OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
