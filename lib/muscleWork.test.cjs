const assert = require('assert');
const {
    getPrimaryExerciseVariationFromList,
    getMusclesFromVariationChain,
    resolveMuscleKeysForSet,
    buildReverseEquivalentMuscleMap,
} = require('./muscleWork');

(() => {
    {
        const chain = [
            {
                _id: 'ex-squat',
                isExercice: true,
                muscles: { primary: ['quads', 'glutes'], secondary: ['hamstrings'] },
            },
            {
                _id: 'det-barre',
                isExercice: false,
                muscles: { primary: ['chest'], secondary: ['triceps', 'deltoids_front'] },
            },
        ];

        const muscles = getMusclesFromVariationChain(chain, new Map());
        assert.deepStrictEqual(muscles.sort(), ['glutes', 'hamstrings', 'quads'].sort());
    }

    {
        const legacyId = 'legacy-adduction';
        const reverseMap = buildReverseEquivalentMuscleMap([{
            _id: 'canonical-adduction',
            muscles: { primary: ['adductors'], secondary: ['glutes'] },
            equivalentTo: [legacyId],
        }]);
        const chain = [{ _id: legacyId, isExercice: true }];
        const muscles = getMusclesFromVariationChain(chain, reverseMap);
        assert.deepStrictEqual(muscles.sort(), ['adductors', 'glutes'].sort());
    }

    {
        const variationById = new Map([
            ['ex-squat', {
                _id: 'ex-squat',
                isExercice: true,
                muscles: { primary: ['quads'], secondary: [] },
            }],
            ['det-machine', {
                _id: 'det-machine',
                isExercice: false,
                muscles: { primary: ['chest'], secondary: ['triceps'] },
            }],
        ]);
        const set = {
            variations: [
                { variation: 'ex-squat' },
                { variation: 'det-machine' },
            ],
        };
        const muscles = resolveMuscleKeysForSet(set, variationById, new Map());
        assert.deepStrictEqual(muscles, ['quads']);
    }

    {
        const primary = getPrimaryExerciseVariationFromList([
            { _id: 'a', isExercice: true, equivalentTo: ['root'] },
            { _id: 'root', isExercice: true },
        ]);
        assert.strictEqual(String(primary._id), 'a');
    }

    console.log('muscleWork.test.cjs passed');
})();
