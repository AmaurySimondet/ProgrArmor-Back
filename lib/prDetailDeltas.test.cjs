const assert = require('assert');
const { resolvePrDetailDeltas } = require('./set');

(() => {
    {
        const result = resolvePrDetailDeltas({
            status: null,
            statusReason: 'belowHistoricalLoadAtSameReps',
            unit: 'repetitions',
            currentValue: 8,
            currentEffectiveLoad: 70,
            currentEffectiveLoadLbs: 154.3,
            referenceBestSet: { value: 8 },
            referenceEffectiveLoad: 80,
            referenceEffectiveLoadLbs: 176.4,
        });
        assert.strictEqual(result.repsDelta, 0);
        assert.strictEqual(result.kgDelta, -10);
        assert.strictEqual(result.lbsDelta, -22.1);
    }

    {
        const result = resolvePrDetailDeltas({
            status: null,
            statusReason: 'belowHistoricalValueAtSameLoad',
            unit: 'repetitions',
            currentValue: 8,
            currentEffectiveLoad: 80,
            currentEffectiveLoadLbs: 176.4,
            referenceBestSet: { value: 12 },
            referenceEffectiveLoad: 80,
            referenceEffectiveLoadLbs: 176.4,
        });
        assert.strictEqual(result.repsDelta, -4);
        assert.strictEqual(result.kgDelta, 0);
        assert.strictEqual(result.lbsDelta, 0);
    }

    {
        const result = resolvePrDetailDeltas({
            status: null,
            statusReason: 'belowHistoricalValueAtSameLoad',
            unit: 'seconds',
            currentValue: 30,
            currentEffectiveLoad: 0,
            currentEffectiveLoadLbs: 0,
            referenceBestSet: { value: 45 },
            referenceEffectiveLoad: 0,
            referenceEffectiveLoadLbs: 0,
        });
        assert.strictEqual(result.secondsDelta, -15);
        assert.strictEqual(result.kgDelta, 0);
    }

    console.log('prDetailDeltas.test.cjs — OK');
})();
