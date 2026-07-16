const assert = require('assert');
const {
    getPrimaryExerciseVariationFromList,
    getMusclesFromVariationChain,
    resolveMusclesFromVariationChain,
    resolveMuscleKeysForSet,
    buildReverseEquivalentMuscleMap,
    isMuscleTypeDetail,
    MUSCLE_TYPE_ID,
} = require('./muscleWork');

(() => {
    {
        // Détail non-Muscle avec tags → ignoré (machine, etc.)
        const chain = [
            {
                _id: 'ex-squat',
                isExercice: true,
                muscles: { primary: ['quads', 'glutes'], secondary: ['hamstrings'] },
            },
            {
                _id: 'det-barre',
                isExercice: false,
                type: '669cee980c89e9434327caa0',
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
                type: 'other-type',
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

    {
        // Curl sans tags + détail Muscle Ischio → hamstrings (pas biceps via reverse map)
        const reverseMap = buildReverseEquivalentMuscleMap([{
            _id: 'curl-barre',
            muscles: { primary: ['biceps'], secondary: ['forearms'] },
            equivalentTo: ['curl'],
        }]);
        const chain = [
            { _id: 'curl', isExercice: true },
            {
                _id: 'ischio',
                isExercice: false,
                type: MUSCLE_TYPE_ID,
                muscles: { primary: ['hamstrings'], secondary: [] },
            },
        ];
        assert.strictEqual(isMuscleTypeDetail(chain[1]), true);
        const resolved = resolveMusclesFromVariationChain(chain, reverseMap);
        assert.deepStrictEqual(resolved.primary, ['hamstrings']);
        assert.deepStrictEqual(resolved.secondary, []);
        assert.deepStrictEqual(resolved.all, ['hamstrings']);
    }

    {
        // Curl seul + reverse map biceps → fallback conservé
        const reverseMap = buildReverseEquivalentMuscleMap([{
            _id: 'curl-barre',
            muscles: { primary: ['biceps'], secondary: ['forearms'] },
            equivalentTo: ['curl'],
        }]);
        const chain = [{ _id: 'curl', isExercice: true }];
        const muscles = getMusclesFromVariationChain(chain, reverseMap);
        assert.deepStrictEqual(muscles.sort(), ['biceps', 'forearms'].sort());
    }

    {
        // Plusieurs détails Muscle → union
        const chain = [
            { _id: 'curl', isExercice: true, muscles: { primary: ['biceps'], secondary: [] } },
            {
                _id: 'ischio',
                isExercice: false,
                type: MUSCLE_TYPE_ID,
                muscles: { primary: ['hamstrings'], secondary: [] },
            },
            {
                _id: 'glutes',
                isExercice: false,
                type: { _id: MUSCLE_TYPE_ID },
                muscles: { primary: ['glutes'], secondary: [] },
            },
        ];
        const muscles = getMusclesFromVariationChain(chain, new Map());
        assert.deepStrictEqual(muscles.sort(), ['glutes', 'hamstrings'].sort());
    }

    console.log('muscleWork.test.cjs passed');
})();
