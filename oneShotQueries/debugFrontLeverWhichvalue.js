/**
 * Debug whichvalue-figure for Front Lever (generic edges missing).
 *
 * Usage:
 *   node oneShotQueries/debugFrontLeverWhichvalue.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');
const whichfigure = require('../lib/whichfigure');

const USER_ID = '6365489f44d4b4000470882b';
const TUCK_FL_ID = '692214541c858345acc2d41a';
const REFERENCE_VARIATIONS = [TUCK_FL_ID];
const WINDOW_DAYS = 180;

function getIsoDateLocalDaysAgo(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function label(entry) {
    if (!entry?.name) return entry?.variationId || entry?.variationSignature || '?';
    if (typeof entry.name === 'string') return entry.name;
    return entry.name.fr || entry.name.en || '?';
}

function entryKey(entry) {
    return entry?.variationSignature || entry?.variationId || '';
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    await mongoose.connect(mongoUrl + database);

    const dateMin180 = getIsoDateLocalDaysAgo(WINDOW_DAYS);

    const allowlist = await setLib.resolveFigureRecommendationAllowlist({
        userId: USER_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        mainExerciseId: TUCK_FL_ID,
        dateMin: dateMin180,
        lateralMode: 'bilateral',
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
    });
    console.log('\n=== Allowlist ===');
    console.log('familyVariationIds:', [...(allowlist.familyVariationIds || [])]);
    console.log('edgeVariationIds:', [...(allowlist.edgeVariationIds || [])]);
    console.log('targetVariationIds (capped):', [...(allowlist.variationIds || [])]);
    console.log('signatures count:', allowlist.signatures?.size ?? 0);

    const figurePayload = await setLib.getFigureDetailedPRs({
        userId: USER_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        mainExerciseId: TUCK_FL_ID,
        dateMin: dateMin180,
        lateralMode: 'bilateral',
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
    });

    console.log('\n=== Figure detailed entries ===');
    for (const e of figurePayload.entries) {
        console.log(`  key=${entryKey(e)} edge=${e.isEdgeTarget === true} direct=${e.isDirect} prSlots=${Object.keys(e.prs || {}).length} name="${label(e)}"`);
    }

    const valueResult = await whichfigure.computeRecommendedValueFigure({
        userId: USER_ID,
        mainExerciseId: TUCK_FL_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        targetUnit: 'repetitions',
        effectiveWeightLoad: 0,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        lateralMode: 'bilateral',
        dateMin: dateMin180,
    });

    console.log('\n=== whichvalue @0kg ===');
    for (const r of valueResult.recommendations || []) {
        console.log(`  key=${r.variationSignature || r.variationId} reps=${r.recommendedValue} success=${r.success} scope=${r.progressionScope} generic=${r.isGenericProgressionTarget} pr=${r.usedSets?.usedHistoricalSets} name="${label(r)}"`);
    }

    const recKeys = new Set((valueResult.recommendations || []).map((r) => String(r.variationSignature || r.variationId)));
    const missingEdges = [...(allowlist.edgeVariationIds || [])].filter((id) => !recKeys.has(String(id)));
    console.log('\n=== Edge IDs in allowlist but missing from recommendations ===');
    for (const id of missingEdges) {
        console.log(`  MISSING edge: ${id}`);
    }

    const VariationProgressionEdge = require('../schema/variationProgressionEdge');
    const genericEdges = await VariationProgressionEdge.find(
        { isActive: true, contextVariationId: null },
        { fromVariationId: 1, toVariationId: 1 },
    ).lean();
    const genericNodeIds = new Set();
    for (const edge of genericEdges) {
        if (edge.fromVariationId) genericNodeIds.add(String(edge.fromVariationId));
        if (edge.toVariationId) genericNodeIds.add(String(edge.toVariationId));
    }
    const straddleFullIds = ['692214541c858345acc2d423', '692214541c858345acc2d426'];
    console.log('\n=== Straddle/Full generic graph presence ===');
    for (const id of straddleFullIds) {
        console.log(`  ${id}: inGenericGraph=${genericNodeIds.has(id)} inAllowlist=${allowlist.variationIds.has(id)} inRecs=${recKeys.has(id)}`);
    }
}

run()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
