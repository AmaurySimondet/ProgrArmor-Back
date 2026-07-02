/**
 * Tests unitaires — scénarios « programme présent mais vide »
 * Usage: node lib/emptyProgramAudit.test.js
 */
const assert = require('assert');
const {
    ISSUE,
    isTemplateEntryVisibleInQuickStart,
    simulateQuickStartModal,
    simulateProgramTemplateToWorkoutExercises,
    classifyProgram,
} = require('./emptyProgramAudit');

const VAR_A = '507f1f77bcf86cd799439011';
const VAR_B = '507f1f77bcf86cd799439012';
const VAR_MISSING = '507f1f77bcf86cd799439099';

const variationMap = new Map([
    [VAR_A, true],
    [VAR_B, true],
]);

// H1 — template vide malgré historique de séances
{
    const program = {
        _id: 'prog1',
        name: 'Push',
        program: [],
        seanceCount: 5,
        lastSeanceId: 'seance1',
    };
    const result = classifyProgram(program, {
        seanceCount: 5,
        lastSeanceSetCount: 8,
    });
    assert.ok(result.issues.includes(ISSUE.EMPTY_TEMPLATE_WITH_SEANCES));
    assert.strictEqual(result.quickStart.appearsEmptyInModal, true);
    assert.strictEqual(result.quickStart.wouldStartFromLastWithExercises, true);
    assert.strictEqual(result.quickStart.userPerceivesAsBroken, false);
}

// H3 — template non vide mais variations introuvables → UI vide
{
    const program = {
        _id: 'prog2',
        name: 'Pull',
        program: [{
            variationIds: [VAR_MISSING],
            variationName: { fr: '', en: '' },
            sets: [{ unit: 'repetitions', value: 8 }],
        }],
        seanceCount: 3,
        lastSeanceId: 'seance2',
    };
    const result = classifyProgram(program, {
        seanceCount: 3,
        variationExistsById: variationMap,
        lastSeanceSetCount: 6,
    });
    assert.ok(result.issues.includes(ISSUE.TEMPLATE_UNRESOLVABLE));
    assert.strictEqual(result.quickStart.appearsEmptyInModal, true);
    assert.strictEqual(result.resolvedExerciseCount, 0);
}

// Entrée avec variationName mais IDs invalides → encore visible (fallback UI)
{
    const entry = {
        variationIds: [VAR_MISSING],
        variationName: { fr: 'Traction', en: 'Pull-up' },
    };
    assert.strictEqual(
        isTemplateEntryVisibleInQuickStart(entry, variationMap),
        true,
    );
}

// programTemplateToWorkoutExercises ne garde pas les stubs sans variation valide
{
    const exercises = simulateProgramTemplateToWorkoutExercises(
        [{ variationIds: [VAR_MISSING], variationName: { fr: 'Traction' } }],
        variationMap,
    );
    assert.strictEqual(exercises.length, 0);
}

// H2 — pas de lastSeanceId mais séances existent (getProgramById compense en prod)
{
    const program = {
        _id: 'prog3',
        name: 'Legs',
        program: [{ variationIds: [VAR_A], sets: [{ unit: 'repetitions', value: 10 }] }],
        seanceCount: 2,
    };
    const result = classifyProgram(program, {
        seanceCount: 2,
        variationExistsById: variationMap,
        lastSeanceSetCount: 4,
    });
    assert.ok(result.issues.includes(ISSUE.MISSING_LAST_SEANCE_ID));
    assert.strictEqual(result.quickStart.hasLastSeanceButton, false);
}

// H5 — dernière séance sans sets → démarrage vide
{
    const program = {
        _id: 'prog4',
        name: 'Core',
        program: [],
        seanceCount: 1,
        lastSeanceId: 'seance-empty',
    };
    const result = classifyProgram(program, {
        seanceCount: 1,
        lastSeanceSetCount: 0,
    });
    assert.ok(result.issues.includes(ISSUE.LAST_SEANCE_WITHOUT_SETS));
    assert.strictEqual(result.quickStart.wouldStartFromLastWithExercises, false);
    assert.strictEqual(result.quickStart.userPerceivesAsBroken, true);
}

// H4 — suggestion cycle sans lastSeanceId si getProgram échoue
{
    const suggestionFallback = {
        _id: 'prog5',
        name: 'Cycle prog',
        program: [],
        seanceCount: 4,
    };
    const quickStart = simulateQuickStartModal(suggestionFallback);
    assert.strictEqual(quickStart.hasLastSeanceButton, false);
    assert.strictEqual(quickStart.userPerceivesAsBroken, true);

    const fromSuggestion = classifyProgram(suggestionFallback, {
        seanceCount: 4,
        fromSuggestionOnly: true,
        lastSeanceSetCount: 0,
    });
    assert.ok(fromSuggestion.issues.includes(ISSUE.SUGGESTION_METADATA_ONLY));
}

// Programme sain
{
    const program = {
        _id: 'prog6',
        name: 'Full',
        program: [{ variationIds: [VAR_A, VAR_B], sets: [{ unit: 'repetitions', value: 5 }] }],
        seanceCount: 10,
        lastSeanceId: 'seance-ok',
    };
    const result = classifyProgram(program, {
        seanceCount: 10,
        variationExistsById: variationMap,
        lastSeanceSetCount: 12,
    });
    assert.deepStrictEqual(result.issues, [ISSUE.HEALTHY]);
    assert.strictEqual(result.quickStart.appearsEmptyInModal, false);
}

console.log('emptyProgramAudit.test.js — tous les tests passent ✓');
