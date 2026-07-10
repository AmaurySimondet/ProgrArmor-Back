const assert = require('assert');
const {
    aggregateMuscleRecencyFromSets,
    aggregateMuscleRecencyFromVariations,
    buildReverseEquivalentMuscleMap,
    computeDaysSince,
} = require('./userMuscleRecency');

(() => {
    const referenceDate = new Date('2026-07-06T12:00:00.000Z');

    {
        const daysSince = computeDaysSince('2026-07-06T08:00:00.000Z', referenceDate);
        assert.strictEqual(daysSince, 0);
    }

    {
        const daysSince = computeDaysSince('2026-07-04T23:59:00.000Z', referenceDate);
        assert.strictEqual(daysSince, 2);
    }

    {
        const variationLastDates = [
            { _id: 'var1', lastDate: new Date('2026-07-06T10:00:00.000Z') },
            { _id: 'var2', lastDate: new Date('2026-07-02T10:00:00.000Z') },
        ];
        const variations = [
            { _id: 'var1', isExercice: true, muscles: { primary: ['chest'], secondary: ['triceps'] } },
            { _id: 'var2', isExercice: true, muscles: { primary: ['lats'], secondary: [] } },
        ];

        const result = aggregateMuscleRecencyFromVariations(
            variationLastDates,
            variations,
            referenceDate,
        );

        assert.strictEqual(result.muscles.chest.lastWorkedDate, '2026-07-06');
        assert.strictEqual(result.muscles.chest.daysSince, 0);
        assert.strictEqual(result.muscles.triceps.lastWorkedDate, '2026-07-06');
        assert.strictEqual(result.muscles.lats.lastWorkedDate, '2026-07-02');
        assert.strictEqual(result.muscles.lats.daysSince, 4);
    }

    {
        const variationLastDates = [
            { _id: 'var1', lastDate: new Date('2026-07-01T10:00:00.000Z') },
            { _id: 'var2', lastDate: new Date('2026-07-05T10:00:00.000Z') },
        ];
        const variations = [
            { _id: 'var1', isExercice: true, muscles: { primary: ['chest'], secondary: [] } },
            { _id: 'var2', isExercice: true, muscles: { primary: ['chest'], secondary: [] } },
        ];

        const result = aggregateMuscleRecencyFromVariations(
            variationLastDates,
            variations,
            referenceDate,
        );

        assert.strictEqual(result.muscles.chest.lastWorkedDate, '2026-07-05');
        assert.strictEqual(result.muscles.chest.daysSince, 1);
    }

    {
        const legacyAdductionId = '669c3609218324e0b7682b75';
        const canonicalAdduction = {
            _id: '6922144c1c858345acc2d0c5',
            muscles: { primary: ['adductors'], secondary: ['glutes'] },
            equivalentTo: [legacyAdductionId],
        };
        const reverseMap = buildReverseEquivalentMuscleMap([canonicalAdduction]);
        const variationById = new Map([
            [legacyAdductionId, { _id: legacyAdductionId, isExercice: true }],
        ]);
        const sets = [{
            date: new Date('2026-07-05T10:00:00.000Z'),
            seance: 'seance-adductors-1',
            variations: [{ variation: legacyAdductionId }],
        }];

        const result = aggregateMuscleRecencyFromSets(
            sets,
            variationById,
            reverseMap,
            referenceDate,
        );

        assert.strictEqual(result.muscles.adductors.lastWorkedDate, '2026-07-05');
        assert.strictEqual(result.muscles.adductors.daysSince, 1);
        assert.strictEqual(result.muscles.adductors.lastSeanceId, 'seance-adductors-1');
        assert.strictEqual(result.muscles.glutes.lastWorkedDate, '2026-07-05');
    }

    {
        const sets = [{
            date: new Date('2026-07-06T10:00:00.000Z'),
            seance: 'seance-chest-today',
            variations: [{ variation: 'var1' }],
        }, {
            date: new Date('2026-07-05T10:00:00.000Z'),
            seance: 'seance-chest-yesterday',
            variations: [{ variation: 'var1' }],
        }];
        const variationById = new Map([
            ['var1', { _id: 'var1', isExercice: true, muscles: { primary: ['chest'], secondary: [] } }],
        ]);

        const result = aggregateMuscleRecencyFromSets(
            sets,
            variationById,
            new Map(),
            referenceDate,
        );

        assert.strictEqual(result.muscles.chest.lastWorkedDate, '2026-07-06');
        assert.strictEqual(result.muscles.chest.lastSeanceId, 'seance-chest-today');
    }

    {
        const variationById = new Map([
            ['ex-squat', {
                _id: 'ex-squat',
                isExercice: true,
                muscles: { primary: ['quads', 'glutes'], secondary: ['hamstrings'] },
            }],
            ['det-barre', {
                _id: 'det-barre',
                isExercice: false,
                muscles: { primary: ['chest'], secondary: ['triceps', 'deltoids_front'] },
            }],
        ]);
        const sets = [{
            date: new Date('2026-07-07T10:00:00.000Z'),
            seance: 'seance-squat',
            variations: [
                { variation: 'ex-squat' },
                { variation: 'det-barre' },
            ],
        }];

        const result = aggregateMuscleRecencyFromSets(
            sets,
            variationById,
            new Map(),
            referenceDate,
        );

        assert.ok(result.muscles.quads);
        assert.ok(result.muscles.glutes);
        assert.ok(result.muscles.hamstrings);
        assert.strictEqual(result.muscles.chest, undefined);
        assert.strictEqual(result.muscles.triceps, undefined);
        assert.strictEqual(result.muscles.deltoids_front, undefined);
    }

    console.log('userMuscleRecency.test.cjs passed');
})();
