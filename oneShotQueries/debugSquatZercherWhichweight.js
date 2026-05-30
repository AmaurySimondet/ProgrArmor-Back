/**
 * Compare family rows vs whichweight-figure targets for Squat Zercher + Barre guidée.
 *
 * Usage:
 *   node oneShotQueries/debugSquatZercherWhichweight.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');
const whichfigure = require('../lib/whichfigure');
const Variation = require('../schema/variation');

const USER_ID = '6365489f44d4b4000470882b';
const SQUAT_ZERCHER_ID = '6922144d1c858345acc2d117';
const BARRE_GUIDEE_ID = '669c3609218324e0b7682ab9';
const REFERENCE_VARIATIONS = [SQUAT_ZERCHER_ID, BARRE_GUIDEE_ID];
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

function countUsedHistoricalSetsFromPrs(prs) {
    if (!prs || typeof prs !== 'object') return 0;
    const ids = new Set();
    for (const key of Object.keys(prs)) {
        const rep = prs?.[key]?.repetitions;
        const sec = prs?.[key]?.seconds;
        if (rep?._id != null) ids.add(String(rep._id));
        if (sec?._id != null) ids.add(String(sec._id));
    }
    return ids.size;
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
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    }
    await mongoose.connect(mongoUrl + database);

    const zercherDoc = await Variation.findById(SQUAT_ZERCHER_ID, { name: 1, equivalentTo: 1, isExercice: 1 }).lean();
    const barreDoc = await Variation.findById(BARRE_GUIDEE_ID, { name: 1, equivalentTo: 1, isExercice: 1 }).lean();
    console.log('=== Variations ===');
    console.log('Squat Zercher:', zercherDoc?.name?.fr, SQUAT_ZERCHER_ID, 'equivalentTo:', zercherDoc?.equivalentTo?.map(String));
    console.log('Barre guidée:', barreDoc?.name?.fr, BARRE_GUIDEE_ID);

    const familyPayload = await setLib.resolvePerformedFamilyTargets({
        userId: USER_ID,
        variations: REFERENCE_VARIATIONS,
        familyKey: null,
        dateMin: null,
        lateralMode: 'bilateral',
    });
    console.log('\n=== Family rows (resolvePerformedFamilyTargets) ===');
    console.log('rowsCount:', familyPayload.rows.length);
    familyPayload.rows.forEach((row, i) => {
        console.log(`${i + 1}. name="${row.name?.fr}" variationId=${row.variationId} progressionSignature=${row.progressionSignature} chartSig=${row.chartSourceVariationSignature} count=${row.count}`);
    });

    const allowlist = await setLib.resolveFigureRecommendationAllowlist({
        userId: USER_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        mainExerciseId: SQUAT_ZERCHER_ID,
        familyKey: null,
        dateMin: null,
        lateralMode: 'bilateral',
        includeAllGraphTargets: true,
        maxTargets: 40,
    });
    console.log('\n=== Allowlist (whichweight figure) ===');
    console.log('targetVariationIds:', allowlist.targetVariationIds);
    console.log('signatures:', [...allowlist.signatures]);
    console.log('edgeVariationIds:', [...allowlist.edgeVariationIds]);
    console.log('familyScopeDebug:', allowlist.familyScopeDebug);

    const [figurePayload, progressionPayload] = await Promise.all([
        setLib.getFigureDetailedPRs({
            userId: USER_ID,
            referenceVariations: REFERENCE_VARIATIONS,
            mainExerciseId: SQUAT_ZERCHER_ID,
            familyKey: null,
            dateMin: null,
            lateralMode: 'bilateral',
            includeAllGraphTargets: true,
            maxTargets: 40,
        }),
        setLib.getProgressionDetailedPRs({
            userId: USER_ID,
            referenceVariations: REFERENCE_VARIATIONS,
            mainExerciseId: SQUAT_ZERCHER_ID,
            familyKey: null,
            dateMin: null,
            lateralMode: 'bilateral',
            includeAllGraphTargets: true,
            maxTargets: 40,
        }),
    ]);

    console.log('\n=== getFigureDetailedPRs entries (pre-merge) ===');
    figurePayload.entries.forEach((e, i) => {
        const hist = e?.prs?.reduce?.((s, p) => s + (p?.sets?.length || 0), 0) ?? '?';
        console.log(`${i + 1}. key=${entryKey(e)} isDirect=${e.isDirect} name="${label(e)}" prSets~${hist}`);
    });

    console.log('\n=== getProgressionDetailedPRs entries (pre-merge) ===');
    console.log('referenceVariationSignature:', progressionPayload.referenceVariationSignature);
    progressionPayload.entries.forEach((e, i) => {
        const hist = e?.prs?.reduce?.((s, p) => s + (p?.sets?.length || 0), 0) ?? '?';
        console.log(`${i + 1}. key=${entryKey(e)} isDirect=${e.isDirect} name="${label(e)}" prSets~${hist}`);
    });

    const weightResult = await whichfigure.computeRecommendedWeightFigure({
        userId: USER_ID,
        mainExerciseId: SQUAT_ZERCHER_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        targetUnit: 'repetitions',
        targetValue: 10,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        lateralMode: 'bilateral',
        familyKey: null,
    });

    const valueResult = await whichfigure.computeRecommendedValueFigure({
        userId: USER_ID,
        mainExerciseId: SQUAT_ZERCHER_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        targetUnit: 'repetitions',
        effectiveWeightLoad: 85,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        lateralMode: 'bilateral',
        familyKey: null,
    });

    console.log('\n=== whichvalue-figure @85kg (zercher focus) ===');
    (valueResult.recommendations || [])
        .filter((r) => String(r?.name?.fr || r?.name?.en || '').toLowerCase().includes('zercher'))
        .forEach((r, i) => {
            console.log(`${i + 1}. key=${r.variationSignature || r.variationId} reps=${r.recommendedValue} hist=${r.usedSets?.usedHistoricalSets} peak1rm=${r.strengthPeak?.normalizedOneRm} peakSet=${r.strengthPeak?.setId} name="${r.name?.fr || r.name?.en}"`);
        });

    console.log('\n=== whichweight-figure recommendations ===');
    (weightResult.recommendations || []).forEach((r, i) => {
        console.log(`${i + 1}. key=${r.variationSignature || r.variationId} success=${r.success} load=${r.recommendedLoadKg} hist=${r.usedSets?.usedHistoricalSets} name="${label(r)}"`);
    });

    const familyKeys = new Set(familyPayload.rows.map((r) => r.progressionSignature));
    const recKeys = new Set((weightResult.recommendations || []).map((r) => String(r.variationSignature || r.variationId)));
    const chartKeys = new Set(familyPayload.rows.map((r) => r.chartSourceVariationSignature));

    console.log('\n=== Diff family vs whichweight ===');
    for (const row of familyPayload.rows) {
        const sig = row.progressionSignature;
        const chartSig = row.chartSourceVariationSignature;
        const inRecByProg = recKeys.has(sig);
        const inRecByChart = recKeys.has(chartSig);
        const inRecByVarId = recKeys.has(String(row.variationId));
        if (!inRecByProg && !inRecByChart && !inRecByVarId) {
            console.log(`MISSING: "${row.name?.fr}" progressionSignature=${sig} chartSig=${chartSig} variationId=${row.variationId}`);
        }
    }

    console.log('\n=== Zercher-specific ===');
    const zercherSoloSig = SQUAT_ZERCHER_ID;
    const zercherComboSig = [SQUAT_ZERCHER_ID, BARRE_GUIDEE_ID].sort().join('|');
    console.log('zercher solo in family signatures:', familyKeys.has(zercherSoloSig));
    console.log('zercher combo in family signatures:', familyKeys.has(zercherComboSig));
    console.log('zercher solo in recommendations:', recKeys.has(zercherSoloSig));
    console.log('zercher combo in recommendations:', recKeys.has(zercherComboSig));
    console.log('zercher solo in chart signatures:', chartKeys.has(zercherSoloSig));

    console.log('\n=== Diagnostic ===');
    console.log('Combo filter (filterMergedEntriesForExplicitComboSignature) removed — all merged family/progression targets are kept until dedupe.');

    const dateMin180 = getIsoDateLocalDaysAgo(WINDOW_DAYS);
    console.log(`\n=== Fenêtre ${WINDOW_DAYS}j (dateMin=${dateMin180}) — family vs PR slots ===`);

    const family180 = await setLib.resolvePerformedFamilyTargets({
        userId: USER_ID,
        variations: REFERENCE_VARIATIONS,
        familyKey: null,
        dateMin: dateMin180,
        lateralMode: 'bilateral',
    });
    const zercherFamilyRows = family180.rows.filter((row) =>
        String(row?.name?.fr || '').toLowerCase().includes('zercher'),
    );
    for (const row of zercherFamilyRows) {
        console.log(`Family: "${row.name?.fr}" progressionSig=${row.progressionSignature} chartSig=${row.chartSourceVariationSignature} familyCount=${row.count}`);
    }

    const figure180 = await setLib.getFigureDetailedPRs({
        userId: USER_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        mainExerciseId: SQUAT_ZERCHER_ID,
        familyKey: null,
        dateMin: dateMin180,
        lateralMode: 'bilateral',
        includeAllGraphTargets: true,
        maxTargets: 40,
    });
    console.log('\nFigure detailed PR (signature) — compteur UI historique = ids uniques dans slots PR:');
    for (const entry of figure180.entries.filter((e) => String(label(e)).toLowerCase().includes('zercher'))) {
        const prSlotCount = countUsedHistoricalSetsFromPrs(entry?.prs);
        const matchingFamily = zercherFamilyRows.find((row) =>
            row.chartSourceVariationSignature === entryKey(entry)
            || row.progressionSignature === entryKey(entry),
        );
        console.log(`  "${label(entry)}" key=${entryKey(entry)} prSlotCount=${prSlotCount} familyCount=${matchingFamily?.count ?? 'n/a'} progressionSig=${matchingFamily?.progressionSignature ?? 'n/a'}`);
    }

    const value65 = await whichfigure.computeRecommendedValueFigure({
        userId: USER_ID,
        mainExerciseId: SQUAT_ZERCHER_ID,
        referenceVariations: REFERENCE_VARIATIONS,
        targetUnit: 'repetitions',
        effectiveWeightLoad: 65,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        lateralMode: 'bilateral',
        familyKey: null,
        dateMin: dateMin180,
    });
    console.log(`\nwhichvalue-figure @65kg / ${WINDOW_DAYS}j:`);
    (value65.recommendations || [])
        .filter((r) => String(r?.name?.fr || r?.name?.en || '').toLowerCase().includes('zercher'))
        .forEach((r, i) => {
            console.log(`  ${i + 1}. "${r.name?.fr || r.name?.en}" hist=${r.usedSets?.usedHistoricalSets} reps=${r.recommendedValue} key=${r.variationSignature || r.variationId}`);
        });
    console.log('\nVoir logs serveur [Progression][HistoricalSetCount] pour scopedSetsCount vs prUniqueSetIdsInSlots vs prCollapsedByRmKey.');
}

run()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
