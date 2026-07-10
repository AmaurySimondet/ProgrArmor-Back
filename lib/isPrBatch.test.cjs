const assert = require('assert');
const {
    evaluatePersonalRecordWithPreloadedContext,
    evaluatePersonalRecordsBatch,
} = require('./set');

(async () => {
    const baseContext = {
        bwContext: { includeBodyweight: false, userMeasures: [], weightedBodyweightKg: 0, exerciseBodyWeightRatio: 1 },
        historicalSets: [],
        prReferenceDate: new Date('2026-01-15T12:00:00.000Z'),
        unit: 'repetitions',
        isUnilateral: undefined,
        unilateralSide: undefined,
        isCardio: false,
    };

    {
        const result = evaluatePersonalRecordWithPreloadedContext(baseContext, {
            value: 8,
            weightLoad: 80,
            elastic: null,
            sessionSets: [],
            excludeSetId: 'set-1',
        });
        assert.strictEqual(result.isPersonalRecord, 'NB');
        assert.ok(result.prDetail);
    }

    {
        const contextWithHistory = {
            ...baseContext,
            historicalSets: [{
                unit: 'repetitions',
                value: 8,
                weightLoad: 80,
                effectiveWeightLoad: 80,
                brzycki: 96,
                epley: 96,
            }],
        };
        const result = evaluatePersonalRecordWithPreloadedContext(contextWithHistory, {
            value: 8,
            weightLoad: 80,
            elastic: null,
            sessionSets: [],
            excludeSetId: 'set-1',
        });
        assert.ok(result.prDetail);
        assert.ok(['ATH', 'PR', 'SB', 'NB', null].includes(result.isPersonalRecord));
    }

    {
        const cardioContext = {
            bwContext: null,
            historicalSets: [],
            prReferenceDate: new Date('2026-01-15T12:00:00.000Z'),
            unit: 'cardio',
            isUnilateral: undefined,
            unilateralSide: undefined,
            isCardio: true,
        };
        const result = evaluatePersonalRecordWithPreloadedContext(cardioContext, {
            value: 1200,
            weightLoad: 0,
            cardio: { speedKmh: 10, distanceKm: 2, inclinePercent: 0 },
            sessionSets: [],
            excludeSetId: 'cardio-1',
        });
        assert.strictEqual(result.isPersonalRecord, 'NB');
    }

    assert.strictEqual(typeof evaluatePersonalRecordsBatch, 'function');

    console.log('isPrBatch.test.cjs — OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
