/**
 * Usage: node lib/seanceSetBackfill.test.js
 */
const assert = require("assert");
const {
    resolveUserWeightKgForDate,
    getAffectedDateRangesForMeasureChange,
    computePersistedBodyweightFields,
} = require("../utils/userMeasureTimeline");

const m1 = { measuredAt: new Date("2026-04-20T00:00:00Z"), weight: { kg: 88 } };
const m2 = { measuredAt: new Date("2026-05-12T00:00:00Z"), weight: { kg: 89 } };
const m3 = { measuredAt: new Date("2026-06-01T00:00:00Z"), weight: { kg: 90 } };
const measures = [m1, m2, m3];

{
    const w = resolveUserWeightKgForDate(measures, new Date("2026-03-31T15:59:53Z"));
    assert.strictEqual(w, 88, "set avant M1 → première mesure (88)");
}

{
    const w = resolveUserWeightKgForDate(measures, new Date("2026-05-01T12:00:00Z"));
    assert.strictEqual(w, 88, "entre M1 et M2 → M1");
}

{
    const w = resolveUserWeightKgForDate(measures, new Date("2026-05-20T12:00:00Z"));
    assert.strictEqual(w, 89, "après M2 → M2");
}

{
    const w = resolveUserWeightKgForDate(measures, new Date("2026-06-03T00:00:00Z"));
    assert.strictEqual(w, 90, "après M3 → M3");
}

{
    const ranges = getAffectedDateRangesForMeasureChange({
        measures,
        newMeasuredAt: m2.measuredAt,
    });
    assert.strictEqual(ranges.length, 1);
    assert.strictEqual(ranges[0].dateFrom.getTime(), m2.measuredAt.getTime());
    assert.strictEqual(ranges[0].dateTo.getTime(), m3.measuredAt.getTime());
}

const frontLeverSet = {
    unit: "repetitions",
    weightLoad: 0,
    value: 6,
    effectiveWeightLoad: 0,
    elastic: null,
};

{
    const fields = computePersistedBodyweightFields(frontLeverSet, {
        policy: { includeBodyweight: true, ratio: 0.9 },
        userWeightKg: 88,
    });
    assert.strictEqual(fields.effectiveWeightLoad, 0);
    assert.strictEqual(fields.effectiveWeightLoadWithBodyweight, 79.2);
    assert.strictEqual(fields.oneRepMaxUserWeightKg, 88);
    assert.ok(fields.brzycki != null && fields.brzycki > 0, "brzycki non null");
    assert.ok(fields.epley != null && fields.epley > 0, "epley non null");
    assert.ok(fields.brzyckiWithBodyweight > fields.brzycki, "brzyckiWithBodyweight > charge utile");
}

console.log("seanceSetBackfill.test.js: all tests passed");
