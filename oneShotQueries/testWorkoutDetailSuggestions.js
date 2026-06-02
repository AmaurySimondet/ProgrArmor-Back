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

function summarizeSuggestion(item) {
    if (!item) return '(null)';
    if (item.kind === 'performed') {
        return `performed tier=${item.tier} label="${item.label}" sig=${item.progressionSignature} count=${item.count}`;
    }
    const name = item?.variation?.name?.fr || item?.variation?.name?.en || item?.variation?._id;
    return `exercise tier=${item.tier} id=${item?.variation?._id} name="${name}"`;
}

async function run() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);

    try {
        const payload = await variationLib.getWorkoutDetailSuggestions(TEST_QUERY);
        const { suggestions, total, meta, families } = payload;

        console.log('\n=== INPUT ===');
        console.log(TEST_QUERY);
        console.log('\n=== META ===');
        console.log(meta);
        console.log(`families: ${families?.length || 0}, total suggestions: ${total}`);

        console.log('\n=== SUGGESTIONS (ordered) ===');
        suggestions.forEach((item, index) => {
            console.log(`${index + 1}. ${summarizeSuggestion(item)}`);
        });

        let lastTier = 0;
        let orderOk = true;
        const exerciseIds = new Set();
        const performedSignatures = new Set();
        let duplicateExercise = false;
        let duplicatePerformedSig = false;

        for (const item of suggestions) {
            if (item.tier < lastTier) {
                orderOk = false;
            }
            lastTier = item.tier;
            if (item.kind === 'performed') {
                if (performedSignatures.has(item.progressionSignature)) {
                    duplicatePerformedSig = true;
                }
                performedSignatures.add(item.progressionSignature);
            } else if (item.kind === 'exercise') {
                const id = String(item?.variation?._id || '');
                if (exerciseIds.has(id)) {
                    duplicateExercise = true;
                }
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

        console.log('\n=== ASSERTIONS ===');
        console.log(`tier order non-decreasing: ${orderOk ? 'OK' : 'FAIL'}`);
        console.log(`tier2 after tier1 block: ${tier2AfterTier1 ? 'OK' : 'FAIL'}`);
        console.log(`tier3 after tier2 block: ${tier3AfterTier2 ? 'OK' : 'FAIL'}`);
        console.log(`no duplicate exercise ids in page: ${duplicateExercise ? 'FAIL' : 'OK'}`);
        console.log(`no duplicate performed signatures in page: ${duplicatePerformedSig ? 'FAIL' : 'OK'}`);
        console.log(`no performed+catalog combo duplicate: ${performedOverlapsCatalog ? 'FAIL' : 'OK'}`);

        if (!orderOk || !tier2AfterTier1 || !tier3AfterTier2 || duplicateExercise || duplicatePerformedSig || performedOverlapsCatalog) {
            process.exitCode = 1;
        }
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
