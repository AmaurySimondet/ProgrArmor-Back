/**
 * Tests unitaires — programSuggestions
 * Usage: node lib/programSuggestions.test.js
 */
const assert = require('assert');
const {
    detectRepeatingCycle,
    detectFolderRotation,
    pickVarietySuggestion,
    buildLastSuggestion,
    dedupeSuggestions,
    VARIETY_MIN_DAYS,
    VARIETY_MAX_DAYS,
} = require('./programSuggestions');

const A = 'progA';
const B = 'progB';
const C = 'progC';
const D = 'progD';

// Cycle A,B,C,A,B,C — dernier = C → next = A (wrap) ; si dernier = B → next = C
{
    const ids = [A, B, C, A, B, C];
    const result = detectRepeatingCycle(ids);
    assert.ok(result, 'cycle ABC should be detected');
    assert.strictEqual(result.nextProgramId, A);
    assert.ok(result.repetitions >= 2);
}

{
    const ids = [A, B, C, A, B, C, A, B];
    const result = detectRepeatingCycle(ids);
    assert.ok(result, 'cycle ending at B should be detected');
    assert.strictEqual(result.nextProgramId, C);
}

// Pattern insuffisant
{
    const ids = [A, B, D, A];
    const result = detectRepeatingCycle(ids);
    assert.strictEqual(result, null);
}

// Folder rotation
{
    const result = detectFolderRotation([A, B, C], B);
    assert.strictEqual(result.nextProgramId, C);
}

{
    const result = detectFolderRotation([A, B, C], C);
    assert.strictEqual(result.nextProgramId, A);
}

// Variété : fréquent + pas récent vs abandonné
const now = new Date('2026-05-31T12:00:00.000Z');
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

{
    const candidates = [
        {
            _id: A,
            seanceCount90d: 5,
            lastSeanceDate: daysAgo(20),
            isArchived: false,
        },
        {
            _id: B,
            seanceCount90d: 8,
            lastSeanceDate: daysAgo(60),
            isArchived: false,
        },
        {
            _id: C,
            seanceCount90d: 4,
            lastSeanceDate: daysAgo(3),
            isArchived: false,
        },
    ];

    const pick = pickVarietySuggestion(candidates, [], now);
    assert.ok(pick, 'variety candidate should be found');
    assert.strictEqual(pick.programId, A);
}

{
    const candidates = [
        {
            _id: B,
            seanceCount90d: 8,
            lastSeanceDate: daysAgo(60),
            isArchived: false,
        },
    ];
    const pick = pickVarietySuggestion(candidates, [], now);
    assert.strictEqual(pick, null, 'abandoned program (>45d) should not qualify');
}

{
    const candidates = [
        {
            _id: C,
            seanceCount90d: 4,
            lastSeanceDate: daysAgo(3),
            isArchived: false,
        },
    ];
    const pick = pickVarietySuggestion(candidates, [], now);
    assert.strictEqual(pick, null, 'too recent (<7d) should not qualify');
}

// buildLastSuggestion
{
    const last = buildLastSuggestion({
        _id: 'seance1',
        name: 'Push',
        date: new Date(),
        program: { _id: A, name: 'Push', initials: 'PUS', color: '#fff' },
    });
    assert.strictEqual(last.type, 'last');
    assert.strictEqual(last.programId, A);
}

// Déduplication
{
    const merged = dedupeSuggestions([
        { type: 'last', programId: A, name: 'A' },
        { type: 'cycle', programId: A, name: 'A' },
        { type: 'variety', programId: B, name: 'B' },
    ]);
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].programId, A);
    assert.strictEqual(merged[1].programId, B);
}

// Historique vide
{
    const last = buildLastSuggestion(null);
    assert.strictEqual(last, null);
}

assert.strictEqual(VARIETY_MIN_DAYS, 7);
assert.strictEqual(VARIETY_MAX_DAYS, 45);

console.log('programSuggestions.test.js — OK');
