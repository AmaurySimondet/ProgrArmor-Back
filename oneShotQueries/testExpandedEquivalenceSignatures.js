/**
 * Vérifie l'équivalence supérieure (dépliage récursif equivalentTo).
 *
 * Usage:
 *   node oneShotQueries/testExpandedEquivalenceSignatures.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const set = require('../lib/set');
const Variation = require('../schema/variation');

const EXTENSIONS_MOLLETS_ID = '6922144e1c858345acc2d169';
const EXTENSION_MOLLETS_MACHINE_ID = '6922144c1c858345acc2d0b9';
const MACHINE_ID = '669c3609218324e0b7682aba';
const EXTENSION_LEAF_ID = '669c3609218324e0b7682b73';
const MOLLETS_LEAF_ID = '677e95416294b680edf9762d';

function assertEqual(label, actual, expected) {
    if (actual !== expected) {
        throw new Error(`${label}: attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
    }
    console.log(`OK: ${label}`);
}

function assertIncludesGroup(groups, expectedSortedIds) {
    const targetSig = set.getVariationSignature(expectedSortedIds);
    const found = groups.some((group) => set.getVariationSignature(group) === targetSig);
    if (!found) {
        throw new Error(`Groupe alternatif manquant pour signature ${targetSig}. Groupes: ${JSON.stringify(groups)}`);
    }
    console.log(`OK: groupe alternatif présent (${targetSig})`);
}

function buildMockSetDoc(variationIds) {
    return {
        variations: variationIds.map((id) => ({ variation: id })),
    };
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    }
    await mongoose.connect(mongoUrl + database);

    const seedIds = [
        EXTENSIONS_MOLLETS_ID,
        EXTENSION_MOLLETS_MACHINE_ID,
        MACHINE_ID,
        EXTENSION_LEAF_ID,
        MOLLETS_LEAF_ID,
    ];
    const variationById = await set.loadVariationByIdClosure(seedIds, { equivalentTo: 1, name: 1 });

    const splitExpanded = set.resolveExpandedLeafVariationIds(
        [EXTENSIONS_MOLLETS_ID, MACHINE_ID],
        variationById,
    );
    const comboExpanded = set.resolveExpandedLeafVariationIds(
        [EXTENSION_MOLLETS_MACHINE_ID],
        variationById,
    );
    const expectedExpandedSig = set.getVariationSignature([
        EXTENSION_LEAF_ID,
        MOLLETS_LEAF_ID,
        MACHINE_ID,
    ]);

    assertEqual(
        'split Extensions mollets + Machine expandu',
        set.getVariationSignature(splitExpanded),
        expectedExpandedSig,
    );
    assertEqual(
        'combo Extension mollets machine expandu',
        set.getVariationSignature(comboExpanded),
        expectedExpandedSig,
    );

    const altGroups = await set.getAlternativeVariationGroups([EXTENSIONS_MOLLETS_ID, MACHINE_ID]);
    assertIncludesGroup(altGroups, [EXTENSIONS_MOLLETS_ID, MACHINE_ID]);
    assertIncludesGroup(altGroups, [EXTENSION_LEAF_ID, MOLLETS_LEAF_ID, MACHINE_ID]);
    assertIncludesGroup(altGroups, [EXTENSION_MOLLETS_MACHINE_ID]);

    const splitSet = buildMockSetDoc([EXTENSIONS_MOLLETS_ID, MACHINE_ID]);
    const comboSet = buildMockSetDoc([EXTENSION_MOLLETS_MACHINE_ID]);
    const splitSig = set.getVariationSignature(
        set.resolveExpandedLeafVariationIds(
            splitSet.variations.map((entry) => String(entry.variation)),
            variationById,
        ),
    );
    const comboSig = set.getVariationSignature(
        set.resolveExpandedLeafVariationIds(
            comboSet.variations.map((entry) => String(entry.variation)),
            variationById,
        ),
    );
    assertEqual('signatures progression split vs combo', splitSig, comboSig);

    console.log('\n=== Tous les tests équivalence supérieure sont passés ===');
    await mongoose.disconnect();
}

run().catch(async (error) => {
    console.error('testExpandedEquivalenceSignatures failed:', error);
    try {
        await mongoose.disconnect();
    } catch (_) {
        // ignore
    }
    process.exit(1);
});
