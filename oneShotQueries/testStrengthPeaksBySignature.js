/**
 * Usage: node oneShotQueries/testStrengthPeaksBySignature.js
 */
const { buildStrengthPeaksBySignature } = require('../lib/strengthPeak');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const fixturePoints = [
    {
        setId: 'a',
        date: '2024-01-01',
        sourceVariationSignature: 'sig-a',
        normalizedOneRm: 40,
        brzycki: 40,
        epley: 40,
        rawValue: 10,
        unit: 'repetitions',
    },
    {
        setId: 'b',
        date: '2024-06-01',
        sourceVariationSignature: 'sig-a',
        normalizedOneRm: 95.5,
        brzycki: 95.5,
        epley: 95.5,
        rawValue: 1,
        unit: 'repetitions',
    },
    {
        setId: 'c',
        date: '2024-03-01',
        sourceVariationSignature: 'sig-b',
        normalizedOneRm: 94.5,
        brzycki: 94.5,
        epley: 94.5,
        rawValue: 1,
        unit: 'repetitions',
    },
];

const { peaksBySignature, setCountsBySignature } = buildStrengthPeaksBySignature(fixturePoints);

assert(setCountsBySignature['sig-a'] === 2, 'sig-a count');
assert(setCountsBySignature['sig-b'] === 1, 'sig-b count');
assert(Number(peaksBySignature['sig-a']?.referenceKg) === 95.5, 'sig-a peak');
assert(Number(peaksBySignature['sig-b']?.referenceKg) === 94.5, 'sig-b peak');

console.log('testStrengthPeaksBySignature: OK', {
    sigAPeak: peaksBySignature['sig-a']?.referenceKg,
    sigBPeak: peaksBySignature['sig-b']?.referenceKg,
});
