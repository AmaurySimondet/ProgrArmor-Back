/**
 * Diagnostic: pourquoi « Élévations latérales haltères » n'apparaît pas
 * dans family / graphe pour une ouverture stats poulie + unilatéral ?
 *
 * Usage: node oneShotQueries/debugLateralRaiseFamily.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');
const setLib = require('../lib/set');
const { resolveFamilyAnchorId } = require('../lib/progressionResolution');

const USER_ID = '6365489f44d4b4000470882b';
const POULIE = '6922144d1c858345acc2d114';
const UNILATERAL = '68b6e3e2fefb7daba8c16cac';
const HALTERES = '6922144b1c858345acc2d060';

function summarizeFamilies(payload, label) {
    console.log(`\n=== ${label} ===`);
    const meta = payload?.meta || {};
    console.log('inputVariations:', meta.inputVariations);
    console.log('familySeedVariations:', meta.familySeedVariations);
    console.log('rootExerciseId:', meta.rootExerciseId);
    console.log('maxDepthApplied:', meta.maxDepthApplied);
    console.log('families:', (payload?.families || []).map((f) => ({
        familyKey: f.familyKey,
        depth: f.depth,
        label: f.label,
        memberVariationIds: f.memberVariationIds,
        performedCount: f.performedCount,
    })));
    const rowsByFamily = payload?.performedVariationsByFamily || {};
    for (const [familyKey, rows] of Object.entries(rowsByFamily)) {
        console.log(`rows[${familyKey}]:`, (rows || []).map((row) => ({
            variationId: row.variationId,
            name: row.name?.fr,
            count: row.count,
            chartSignature: row.chartSourceVariationSignature,
            progressionSignature: row.progressionSignature,
        })));
    }
    const allRowIds = new Set(
        Object.values(rowsByFamily).flatMap((rows) => (rows || []).map((r) => r.variationId)),
    );
    console.log('haltères présent dans rows:', allRowIds.has(HALTERES));
}

async function printVariationDocs(ids) {
    const docs = await Variation.find(
        { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
        { name: 1, equivalentTo: 1, isExercice: 1, isUnilateral: 1 },
    ).lean();
    console.log('\n=== Variations catalogue ===');
    for (const doc of docs) {
        console.log({
            id: String(doc._id),
            fr: doc.name?.fr,
            isExercice: doc.isExercice === true,
            isUnilateral: doc.isUnilateral === true,
            equivalentTo: (doc.equivalentTo || []).map(String),
        });
    }
}

async function main() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }
    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    console.log('Connected.\n');

    await printVariationDocs([POULIE, UNILATERAL, HALTERES]);

    const dateMin = new Date();
    dateMin.setDate(dateMin.getDate() - 180);
    const dateMinIso = dateMin.toISOString();

    const scenarios = [
        { label: 'URL stats: poulie + unilatéral', variations: [POULIE, UNILATERAL] },
        { label: 'Poulie seule', variations: [POULIE] },
        { label: 'Haltères seul', variations: [HALTERES] },
    ];

    for (const scenario of scenarios) {
        const payload = await setLib.getNormalFlowPerformedVariationFamilies({
            userId: USER_ID,
            variations: scenario.variations,
            maxDepth: 4,
            dateMin: dateMinIso,
            lateralMode: 'bilateral',
        });
        summarizeFamilies(payload, scenario.label);
    }

    const poulieOnly = await setLib.getNormalFlowPerformedVariationFamilies({
        userId: USER_ID,
        variations: [POULIE],
        maxDepth: 4,
        dateMin: dateMinIso,
        lateralMode: 'bilateral',
    });
    const poulieUnilateral = await setLib.getNormalFlowPerformedVariationFamilies({
        userId: USER_ID,
        variations: [POULIE, UNILATERAL],
        maxDepth: 4,
        dateMin: dateMinIso,
        lateralMode: 'bilateral',
    });
    const singleFamilyKeys = (poulieOnly?.families || []).map((f) => f.familyKey).sort();
    const multiFamilyKeys = (poulieUnilateral?.families || []).map((f) => f.familyKey).sort();
    const multiHasElevationTree = multiFamilyKeys.some((key) => key.startsWith('669c3609218324e0b7682b71'));
    const depthAtLeast3 = (poulieUnilateral?.meta?.maxDepthApplied || 0) >= 3;
    console.log('\n=== Regression multi-input vs poulie seule ===');
    console.log('multi familySeedVariations:', poulieUnilateral?.meta?.familySeedVariations);
    console.log('multi maxDepthApplied:', poulieUnilateral?.meta?.maxDepthApplied);
    console.log('multi has elevation tree:', multiHasElevationTree);
    console.log('single family keys:', singleFamilyKeys);
    console.log('multi family keys:', multiFamilyKeys);
    if (!multiHasElevationTree || !depthAtLeast3) {
        throw new Error('Multi-input must expand equivalentTo (elevation tree, depth >= 3)');
    }
    const singleTopKeys = singleFamilyKeys.slice(0, 3);
    const multiTopKeys = multiFamilyKeys.filter((key) => !key.includes(UNILATERAL)).slice(0, 3);
    if (JSON.stringify(singleTopKeys) !== JSON.stringify(multiTopKeys)) {
        throw new Error(`Family keys diverge: single=${JSON.stringify(singleTopKeys)} multi=${JSON.stringify(multiTopKeys)}`);
    }

    const anchorId = await resolveFamilyAnchorId({ variationId: POULIE });
    const timeseriesPoulieUnilateral = await setLib.getNormalizedProgressionTimeseries({
        userId: USER_ID,
        mainExerciseId: anchorId,
        referenceVariations: [POULIE, UNILATERAL],
        dateMin: dateMinIso,
        lateralMode: 'bilateral',
    });
    const points = timeseriesPoulieUnilateral?.points || [];
    const signatures = [...new Set(points.map((p) => p.sourceVariationSignature).filter(Boolean))];
    console.log('\n=== Timeseries poulie + unilatéral ===');
    console.log('pointsCount:', points.length);
    console.log('signatures:', signatures);
    console.log('haltères signature présente:', signatures.some((sig) => sig.includes(HALTERES)));
}

main()
    .catch((err) => {
        console.error('Diagnostic failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
