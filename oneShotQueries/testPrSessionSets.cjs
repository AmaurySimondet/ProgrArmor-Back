/**
 * PR / ATH : sessionSets pour bloquer un ATH faible déjà dépassé en séance,
 * sans marquer SB les copies identiques d'une série ATH.
 * Usage: node oneShotQueries/testPrSessionSets.cjs
 */
const assert = require('assert');
const {
    normalizeSessionSetsForPrEvaluation,
    filterSessionPeersWithStrongerOneRm,
} = require('../utils/prSessionSets');
const { resolvePrComparisonOneRmKg } = require('../utils/set');

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

console.log('testPrSessionSets.cjs — all OK');
