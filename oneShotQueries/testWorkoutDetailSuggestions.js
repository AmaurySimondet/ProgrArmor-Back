const mongoose = require('mongoose');
require('dotenv').config();

const variationLib = require('../lib/variation');

const TEST_QUERY = {
    userId: '6365489f44d4b4000470882b',
    contextVariationId: '6922144b1c858345acc2d060',
    search: 'Élévations latérales haltères',
    weightType: 'external_free',
    page: 1,
    limit: 20,
    maxDepth: 4
};

/** Curl poignets — contexte par défaut : exercice « Curl poignets » du catalogue. */
const WRIST_CURL_TEST_QUERY = {
    userId: process.env.WORKOUT_DETAIL_TEST_USER_ID || '6365489f44d4b4000470882b',
    contextVariationId: process.env.WORKOUT_DETAIL_WRIST_CONTEXT_ID || '6922144e1c858345acc2d16c',
    search: 'Curl poignets',
    weightType: 'external_free',
    page: 1,
    limit: 20,
    maxDepth: 4
};

function summarizeSuggestion(item) {
    if (!item) return '(null)';
    if (item.kind === 'performed') {
        const pic = item.resolvedPicture ? 'picture=resolved' : 'picture=none';
        return `performed tier=${item.tier} label="${item.label}" count=${item.count} ${pic}`;
    }
    const name = item?.variation?.name?.fr || item?.variation?.name?.en || item?.variation?._id;
    return `exercise tier=${item.tier} id=${item?.variation?._id} name="${name}"`;
}

function runPureScoringUnitTests() {
    console.log('\n=== UNIT: tier1 weighted scoring ===');
    const familySeedIds = ['exerciseA', 'wristDetail'];
    const wristItem = {
        label: 'Curl, Poignets, Unilatéral',
        variationIds: ['exerciseA', 'wristDetail'],
        count: 12,
        familyDepth: 2
    };
    const bicepsItem = {
        label: 'Curl, Biceps, Rotation, Unilatéral',
        variationIds: ['exerciseA', 'bicepsDetail', 'rotation', 'unilateral'],
        count: 72,
        familyDepth: 4
    };
    const searchTokens = ['curl', 'poignets'];
    const maxCount = 72;
    const contextVariationId = 'wristExerciseCombo';
    wristItem.variationIds = [...wristItem.variationIds, contextVariationId];
    const wristScore = variationLib.scorePerformedWorkoutSuggestionItem(wristItem, {
        searchTokens,
        familySeedIds,
        maxCount,
        contextVariationId
    });
    const bicepsScore = variationLib.scorePerformedWorkoutSuggestionItem(bicepsItem, {
        searchTokens,
        familySeedIds,
        maxCount,
        contextVariationId
    });
    console.log(`wrist combo score: ${wristScore.toFixed(4)}`);
    console.log(`biceps combo score: ${bicepsScore.toFixed(4)}`);
    const ranked = variationLib.rankPerformedWorkoutSuggestionItems([bicepsItem, wristItem], {
        search: 'Curl poignets',
        familySeedIds,
        contextVariationId: 'wristExerciseCombo'
    });
    const firstLabel = ranked[0]?.label || '';
    const wristFirst = firstLabel.includes('Poignets');
    console.log(`rank: wrist before biceps: ${wristFirst ? 'OK' : 'FAIL'}`);
    if (!wristFirst || wristScore <= bicepsScore) {
        process.exitCode = 1;
    }
}

function assertSuggestionPage(suggestions, label) {
    let lastTier = 0;
    let orderOk = true;
    const exerciseIds = new Set();
    const performedSignatures = new Set();
    let duplicateExercise = false;
    let duplicatePerformedSig = false;

    for (const item of suggestions) {
        if (item.tier < lastTier) orderOk = false;
        lastTier = item.tier;
        if (item.kind === 'performed') {
            if (performedSignatures.has(item.progressionSignature)) duplicatePerformedSig = true;
            performedSignatures.add(item.progressionSignature);
        } else if (item.kind === 'exercise') {
            const id = String(item?.variation?._id || '');
            if (exerciseIds.has(id)) duplicateExercise = true;
            exerciseIds.add(id);
        }
    }

    const tierSequence = suggestions.map((s) => s.tier);
    const hasTier1 = tierSequence.includes(1);
    const tier2AfterTier1 = !hasTier1 || tierSequence.indexOf(2) === -1 || tierSequence.indexOf(2) >= tierSequence.lastIndexOf(1);
    const tier3AfterTier2 = tierSequence.indexOf(3) === -1 || tierSequence.indexOf(3) >= (tierSequence.indexOf(2) === -1 ? 0 : tierSequence.lastIndexOf(2));

    const catalogComboSignatures = new Set();
    for (const item of suggestions) {
        if (item.kind !== 'exercise') continue;
        const eq = Array.isArray(item?.variation?.equivalentTo)
            ? item.variation.equivalentTo.map(String).filter(Boolean)
            : [];
        if (eq.length >= 2) {
            catalogComboSignatures.add(eq.slice().sort().join('|'));
        }
    }
    const performedOverlapsCatalog = suggestions.some((item) => {
        if (item.kind !== 'performed') return false;
        const prog = String(item.progressionSignature || '');
        const chart = String(item.chartSourceVariationSignature || '');
        return catalogComboSignatures.has(prog) || catalogComboSignatures.has(chart);
    });

    const tier1Performed = suggestions.filter((s) => s.kind === 'performed' && s.tier === 1);
    const tier1WithPicture = tier1Performed.filter((s) => s.resolvedPicture || s.cardVariation?.picture);
    console.log(`\n=== ASSERTIONS (${label}) ===`);
    console.log(`tier order non-decreasing: ${orderOk ? 'OK' : 'FAIL'}`);
    console.log(`tier2 after tier1 block: ${tier2AfterTier1 ? 'OK' : 'FAIL'}`);
    console.log(`tier3 after tier2 block: ${tier3AfterTier2 ? 'OK' : 'FAIL'}`);
    console.log(`no duplicate exercise ids in page: ${duplicateExercise ? 'FAIL' : 'OK'}`);
    console.log(`no duplicate performed signatures in page: ${duplicatePerformedSig ? 'FAIL' : 'OK'}`);
    console.log(`no performed+catalog combo duplicate: ${performedOverlapsCatalog ? 'FAIL' : 'OK'}`);
    console.log(`tier1 with resolved/local picture: ${tier1WithPicture.length}/${tier1Performed.length}`);

    if (!orderOk || !tier2AfterTier1 || !tier3AfterTier2 || duplicateExercise || duplicatePerformedSig || performedOverlapsCatalog) {
        process.exitCode = 1;
    }
}

async function runIntegrationQuery(query, label) {
    console.log(`\n========== ${label} ==========`);
    console.log('\n=== INPUT ===');
    console.log(query);
    const payload = await variationLib.getWorkoutDetailSuggestions(query);
    const { suggestions, total, meta, families } = payload;
    console.log('\n=== META ===');
    console.log(meta);
    console.log(`families: ${families?.length || 0}, total suggestions: ${total}`);
    console.log('\n=== SUGGESTIONS (ordered) ===');
    suggestions.forEach((item, index) => {
        console.log(`${index + 1}. ${summarizeSuggestion(item)}`);
    });
    const tier1Top5 = suggestions.filter((s) => s.kind === 'performed').slice(0, 5);
    console.log('\n=== TIER1 TOP (performed) ===');
    tier1Top5.forEach((item, index) => {
        console.log(`${index + 1}. ${summarizeSuggestion(item)}`);
    });
    assertSuggestionPage(suggestions, label);
}

async function run() {
    runPureScoringUnitTests();

    const runMongo = process.env.SKIP_MONGO_WORKOUT_DETAIL_TEST !== '1';
    if (!runMongo) {
        console.log('\n(SKIP_MONGO_WORKOUT_DETAIL_TEST=1 — intégration Mongo ignorée)');
        return;
    }

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    try {
        await runIntegrationQuery(TEST_QUERY, 'élévations latérales');
        if (WRIST_CURL_TEST_QUERY.contextVariationId) {
            await runIntegrationQuery(WRIST_CURL_TEST_QUERY, 'curl poignets');
        } else {
            console.log('\n(Skip curl poignets: définir WORKOUT_DETAIL_WRIST_CONTEXT_ID pour test intégration)');
        }
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
