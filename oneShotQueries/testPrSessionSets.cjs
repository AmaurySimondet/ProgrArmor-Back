/**
 * PR / ATH : sessionSets pour bloquer un ATH faible déjà dépassé en séance,
 * sans marquer SB les copies identiques d'une série ATH.
 * Usage: node oneShotQueries/testPrSessionSets.cjs
 */
const assert = require('assert');
const {
    normalizeSessionSetsForPrEvaluation,
    filterSessionPeersWithStrongerOneRm,
    matchesSessionSetLateralFilter,
} = require('../utils/prSessionSets');
const { resolvePrComparisonOneRmKg } = require('../utils/set');
const { resolveLateralModeForRecommendation } = require('../lib/progressionResolution');

(function testSessionPeerBeatsAth() {
    const great = {
        _id: 'great',
        unit: 'repetitions',
        value: 10,
        weightLoad: 100,
        isUnilateral: true,
        unilateralSide: 'left',
        effectiveWeightLoad: 100,
    };
    const poor = {
        _id: 'poor',
        unit: 'repetitions',
        value: 10,
        weightLoad: 40,
        isUnilateral: true,
        unilateralSide: 'left',
        effectiveWeightLoad: 40,
    };

    const peers = normalizeSessionSetsForPrEvaluation([great, poor], {
        excludeSetId: 'poor',
        unit: 'repetitions',
        isUnilateral: true,
        unilateralSide: 'left',
    });
    assert.strictEqual(peers.length, 1);
    assert.strictEqual(peers[0].weightLoad, 100);

    const poorOneRm = resolvePrComparisonOneRmKg({
        unit: 'repetitions',
        value: 10,
        weightLoad: 40,
        effectiveWeightLoad: 40,
    });
    const stronger = filterSessionPeersWithStrongerOneRm(peers, poorOneRm);
    assert.strictEqual(stronger.length, 1);
    assert.ok(resolvePrComparisonOneRmKg(stronger[0]) > poorOneRm);

    console.log('testSessionPeerBeatsAth — OK');
})();

(function testDuplicateCopyNotCountedAsStrongerPeer() {
    const original = {
        _id: 'orig',
        unit: 'repetitions',
        value: 12,
        weightLoad: 35,
        isUnilateral: true,
        unilateralSide: 'left',
        effectiveWeightLoad: 35,
    };
    const copy = {
        _id: 'copy',
        unit: 'repetitions',
        value: 12,
        weightLoad: 35,
        isUnilateral: true,
        unilateralSide: 'left',
        effectiveWeightLoad: 35,
    };

    const peersForCopy = normalizeSessionSetsForPrEvaluation([original, copy], {
        excludeSetId: 'copy',
        unit: 'repetitions',
        isUnilateral: true,
        unilateralSide: 'left',
    });
    const copyOneRm = resolvePrComparisonOneRmKg({
        unit: 'repetitions',
        value: 12,
        weightLoad: 35,
        effectiveWeightLoad: 35,
    });
    const stronger = filterSessionPeersWithStrongerOneRm(peersForCopy, copyOneRm);
    assert.strictEqual(stronger.length, 0, 'identical copy must not block ATH');

    console.log('testDuplicateCopyNotCountedAsStrongerPeer — OK');
})();

(function testMatchesSessionSetLateralFilter() {
    const leftSet = { isUnilateral: true, unilateralSide: 'left' };
    const rightSet = { isUnilateral: true, unilateralSide: 'right' };
    const bilateralSet = { isUnilateral: false };

    assert.strictEqual(
        matchesSessionSetLateralFilter(leftSet, { isUnilateral: true, unilateralSide: 'left' }),
        true,
    );
    assert.strictEqual(
        matchesSessionSetLateralFilter(rightSet, { isUnilateral: true, unilateralSide: 'left' }),
        false,
    );
    assert.strictEqual(
        matchesSessionSetLateralFilter(bilateralSet, { isUnilateral: true, unilateralSide: 'left' }),
        false,
    );
    assert.strictEqual(matchesSessionSetLateralFilter(leftSet, {}), true);

    const leftOnly = normalizeSessionSetsForPrEvaluation([leftSet, rightSet], {
        isUnilateral: true,
        unilateralSide: 'left',
    });
    assert.strictEqual(leftOnly.length, 0, 'incomplete sets filtered by normalize');

    const leftWithData = normalizeSessionSetsForPrEvaluation([
        { ...leftSet, unit: 'repetitions', value: 10, weightLoad: 20, effectiveWeightLoad: 20 },
        { ...rightSet, unit: 'repetitions', value: 10, weightLoad: 30, effectiveWeightLoad: 30 },
    ], {
        isUnilateral: true,
        unilateralSide: 'left',
    });
    assert.strictEqual(leftWithData.length, 1);
    assert.strictEqual(leftWithData[0].weightLoad, 20);

    const rightWithData = normalizeSessionSetsForPrEvaluation([
        { ...leftSet, unit: 'repetitions', value: 10, weightLoad: 20, effectiveWeightLoad: 20 },
        { ...rightSet, unit: 'repetitions', value: 10, weightLoad: 30, effectiveWeightLoad: 30 },
    ], {
        isUnilateral: true,
        unilateralSide: 'right',
    });
    assert.strictEqual(rightWithData.length, 1);
    assert.strictEqual(rightWithData[0].weightLoad, 30);

    console.log('testMatchesSessionSetLateralFilter — OK');
})();

(function testResolveLateralModeForRecommendation() {
    assert.strictEqual(resolveLateralModeForRecommendation('bilateral', 'right'), 'right');
    assert.strictEqual(resolveLateralModeForRecommendation('left', 'right'), 'left');
    assert.strictEqual(resolveLateralModeForRecommendation('bilateral', undefined), 'bilateral');
    console.log('testResolveLateralModeForRecommendation — OK');
})();

console.log('testPrSessionSets.cjs — all OK');
