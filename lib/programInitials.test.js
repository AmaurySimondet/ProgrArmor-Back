/**
 * Tests unitaires légers — programInitials (backend)
 * Usage: node lib/programInitials.test.js
 */
const assert = require('assert');
const {
    normalizeInitials,
    deriveInitialsFromName,
    assertValidInitials,
} = require('./programInitials');

assert.strictEqual(normalizeInitials('  abcd  '), 'ABC');
assert.strictEqual(normalizeInitials(''), '');
assert.strictEqual(deriveInitialsFromName('Push Day'), 'PUS');
assert.strictEqual(deriveInitialsFromName(''), 'PRG');
assert.strictEqual(assertValidInitials('XY'), 'XY');
try {
    assertValidInitials('');
    assert.fail('expected throw for empty initials');
} catch (_) {
    // ok
}

console.log('programInitials.test.js — OK');
