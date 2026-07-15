/**
 * Tests unitaires légers — programName (backend)
 * Usage: node lib/programName.test.js
 */
const assert = require('assert');
const {
    escapeRegExp,
    programNamesMatch,
    buildExactNameRegex,
} = require('./programName');

assert.strictEqual(escapeRegExp('Push (A+)'), 'Push \\(A\\+\\)', 'escapeRegExp special chars');

assert.strictEqual(programNamesMatch('Push', 'push'), true, 'programNamesMatch case-insensitive');
assert.strictEqual(programNamesMatch('Push', 'Pull'), false, 'programNamesMatch different');
assert.strictEqual(programNamesMatch('  Legs ', 'Legs'), true, 'programNamesMatch trim');

const pushRegex = buildExactNameRegex('Push');
assert.strictEqual(pushRegex.test('push'), true, 'buildExactNameRegex matches case-insensitive');
assert.strictEqual(pushRegex.test('Push Day'), false, 'buildExactNameRegex rejects partial');
assert.strictEqual(pushRegex.test('My Push'), false, 'buildExactNameRegex rejects suffix');

const specialRegex = buildExactNameRegex('Push (A+)');
assert.strictEqual(specialRegex.test('push (a+)'), true, 'buildExactNameRegex escapes specials');

console.log('programName.test.js — OK');
