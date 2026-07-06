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
            { _id: 'var1', muscles: { primary: ['chest'], secondary: ['triceps'] } },
            { _id: 'var2', muscles: { primary: ['lats'], secondary: [] } },
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
            { _id: 'var1', muscles: { primary: ['chest'], secondary: [] } },
            { _id: 'var2', muscles: { primary: ['chest'], secondary: [] } },
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
        assert.strictEqual(result.muscles.glutes.lastWorkedDate, '2026-07-05');
    }

    console.log('userMuscleRecency.test.cjs passed');
})();
