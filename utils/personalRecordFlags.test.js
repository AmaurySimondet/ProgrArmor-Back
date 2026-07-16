/**
 * Usage: node utils/personalRecordFlags.test.js
 */
const assert = require('assert');
const {
    PERSONAL_RECORD_COUNT_FLAGS,
    isCountedPersonalRecordFlag,
    countPersonalRecordSets,
    personalRecordFlagMongoMatch,
} = require('./personalRecordFlags');

assert.deepStrictEqual([...PERSONAL_RECORD_COUNT_FLAGS], ['PR', 'ATH']);

assert.strictEqual(isCountedPersonalRecordFlag('PR'), true);
assert.strictEqual(isCountedPersonalRecordFlag('ATH'), true);
assert.strictEqual(isCountedPersonalRecordFlag('SB'), false);
assert.strictEqual(isCountedPersonalRecordFlag('NB'), false);
assert.strictEqual(isCountedPersonalRecordFlag(null), false);
assert.strictEqual(isCountedPersonalRecordFlag(undefined), false);

assert.strictEqual(
    countPersonalRecordSets([
        { PR: 'PR' },
        { PR: 'ATH' },
        { PR: 'SB' },
        { PR: 'NB' },
        { PR: null },
        {},
    ]),
    2,
);
assert.strictEqual(countPersonalRecordSets([]), 0);
assert.strictEqual(countPersonalRecordSets(null), 0);

assert.deepStrictEqual(personalRecordFlagMongoMatch(), {
    PR: { $in: ['PR', 'ATH'] },
});

console.log('personalRecordFlags.test.js: all tests passed');
