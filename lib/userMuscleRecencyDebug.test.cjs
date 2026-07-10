const assert = require('assert');
const {
    computeSessionStyleMusclesForSets,
    computeProfileStyleMusclesForSets,
    compareSessionVsProfileMuscles,
    buildSeanceMuscleComparisonReport,
} = require('./userMuscleRecencyDebug');

(() => {
    const variationById = new Map([
        ['ex-squat', {
            _id: 'ex-squat',
            name: { fr: 'Squat' },
            isExercice: true,
            muscles: { primary: ['quads', 'glutes'], secondary: ['hamstrings'] },
        }],
        ['det-barre', {
            _id: 'det-barre',
            name: { fr: 'Barre guidée' },
            isExercice: false,
            muscles: { primary: ['chest'], secondary: ['triceps', 'deltoids_front'] },
        }],
    ]);

    const sets = [{
        _id: 'set1',
        setOrder: 1,
        date: new Date('2026-07-07T17:20:00.000Z'),
        seance: 'seance-1',
        mergedVariationsNames: { fr: 'Squat · Barre guidée' },
        variations: [
            { variation: 'ex-squat' },
            { variation: 'det-barre' },
        ],
    }];

    const sessionStyle = computeSessionStyleMusclesForSets(sets, variationById);
    assert.deepStrictEqual(sessionStyle.primary.sort(), ['glutes', 'quads']);
    assert.deepStrictEqual(sessionStyle.secondary.sort(), ['hamstrings']);

    const profileStyle = computeProfileStyleMusclesForSets(sets, variationById, new Map());
    assert.deepStrictEqual(profileStyle.muscles.sort(), sessionStyle.all.sort());

    const comparison = compareSessionVsProfileMuscles(sessionStyle, profileStyle.muscles);
    assert.deepStrictEqual(comparison.onlyInProfile, []);
    assert.deepStrictEqual(comparison.onlyInSession, []);

    const report = buildSeanceMuscleComparisonReport({
        seanceId: 'seance-1',
        seanceTitle: 'Home gym A sec',
        seanceDate: new Date('2026-07-07T17:20:00.000Z'),
        sets,
        variationById,
        reverseEquivalentMap: new Map(),
        muscleRecencyPayload: {
            muscles: {
                quads: { lastWorkedDate: '2026-07-07', daysSince: 3, lastSeanceId: 'seance-1' },
                chest: { lastWorkedDate: '2026-07-07', daysSince: 3, lastSeanceId: 'seance-1' },
            },
        },
    });

    assert.strictEqual(report.comparison.sessionVsProfile.onlyInProfile.length, 0);
    assert.strictEqual(report.apiAttributed.count, 2);

    console.log('userMuscleRecencyDebug.test.cjs passed');
})();
