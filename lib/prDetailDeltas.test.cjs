const assert = require('assert');
const { resolvePrDetailDeltas } = require('./set');

(() => {
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

    {
        const result = resolvePrDetailDeltas({
            status: 'PR',
            statusReason: 'higherValueAtSameLoad',
            unit: 'seconds',
            currentValue: 26,
            currentEffectiveLoad: 0,
            currentEffectiveLoadLbs: 0,
            referenceBestSet: { value: 25 },
            referenceEffectiveLoad: 0,
            referenceEffectiveLoadLbs: 0,
        });
        assert.strictEqual(result.secondsDelta, 1);
    }

    console.log('prDetailDeltas.test.cjs — OK');
})();
