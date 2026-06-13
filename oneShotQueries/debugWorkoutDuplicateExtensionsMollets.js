/**
 * Diagnostic doublon workout : Extensions mollets + détail matériel.
 *
 * Reproduit areVariationCombinationsEqual / areVariationCanonicalChainsEqual
 * (même logique que ProgArmorApp/utils/variations.js).
 *
 * Usage:
 *   node oneShotQueries/debugWorkoutDuplicateExtensionsMollets.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');

const EXTENSIONS_MOLLETS_ID = '6922144e1c858345acc2d169';
const EXTENSION_MOLLETS_MACHINE_ID = '6922144c1c858345acc2d0b9';
const BARRE_GUIDEE_ID = '669c3609218324e0b7682ab9';
const MACHINE_ID = '669c3609218324e0b7682aba';

const normalizeId = (id) => {
    if (id === null || id === undefined) return null;
    return String(id);
};

const normalizeVariationIdsFromVariation = (variation) => {
    const rawId = variation?._id;
    if (Array.isArray(rawId)) {
        return [...new Set(rawId.map(normalizeId).filter(Boolean))].sort();
    }
    const normalized = normalizeId(rawId);
    return normalized ? [normalized] : [];
};

const normalizeVariationIdsFromVariations = (variations = []) => {
    const ids = variations.flatMap((variation) => normalizeVariationIdsFromVariation(variation));
    return [...new Set(ids)].sort();
};

const flattenVariationEntities = (variation) => {
    if (!variation) return [];
    if (Array.isArray(variation?.variations)) {
        return variation.variations.flatMap((subVariation) => flattenVariationEntities(subVariation));
    }
    return [variation];
};

const flattenVariationList = (variations = []) =>
    (variations || []).flatMap((v) => flattenVariationEntities(v));

const getEquivalentToFirstId = (variation) => {
    if (!variation || !Array.isArray(variation.equivalentTo) || variation.equivalentTo.length === 0) {
        return null;
    }
    const first = variation.equivalentTo[0];
    const rawId = first != null && typeof first === 'object' && first._id != null ? first._id : first;
    return normalizeId(rawId);
};

const getPrimaryExerciseVariationFromList = (variations = []) => {
    const flattened = flattenVariationList(variations);
    const exerciseVariations = flattened.filter((variation) => variation?.isExercice === true);
    if (exerciseVariations.length === 0) return null;

    const matchedOnEquivalentRoot = exerciseVariations.find((variation) => {
        const variationIds = normalizeVariationIdsFromVariation(variation);
        if (variationIds.length === 0) return false;
        const equivalentRootId = getEquivalentToFirstId(variation);
        if (!equivalentRootId) return false;
        return variationIds.includes(equivalentRootId);
    });

    return matchedOnEquivalentRoot || exerciseVariations[0] || null;
};

const normalizeEquivalentIdAtIndex = (variation, index) => {
    if (!variation || !Array.isArray(variation.equivalentTo) || index >= variation.equivalentTo.length) {
        return null;
    }
    const raw = variation.equivalentTo[index];
    const rawId = raw != null && typeof raw === 'object' && raw._id != null ? raw._id : raw;
    return normalizeId(rawId);
};

const getFirstNormalizedIdFromVariation = (variation) => {
    const ids = normalizeVariationIdsFromVariation(variation);
    return ids[0] ?? null;
};

const getVariationCanonicalChain = (variations = []) => {
    const flattened = flattenVariationList(variations);
    const primary = getPrimaryExerciseVariationFromList(flattened);
    if (!primary) return [];

    const detailVariations = flattened.filter((variation) => variation?.isExercice !== true);
    const equivalentCount = Array.isArray(primary.equivalentTo) ? primary.equivalentTo.length : 0;
    const totalLevels = Math.max(equivalentCount, 1 + detailVariations.length);
    const chain = [];

    for (let index = 0; index < totalLevels; index += 1) {
        const fromEquivalent = normalizeEquivalentIdAtIndex(primary, index);
        if (fromEquivalent) {
            chain.push(fromEquivalent);
            continue;
        }

        const fallbackVariation = index === 0 ? primary : detailVariations[index - 1];
        const fromVariation = getFirstNormalizedIdFromVariation(fallbackVariation);
        if (fromVariation) {
            chain.push(fromVariation);
        }
    }

    const chainIds = new Set(chain);
    for (const detail of detailVariations) {
        const detailId = getFirstNormalizedIdFromVariation(detail);
        if (detailId && !chainIds.has(detailId)) {
            chain.push(detailId);
            chainIds.add(detailId);
        }
    }

    return chain;
};

const areVariationCombinationsEqual = (variations1 = [], variations2 = []) => {
    const ids1 = normalizeVariationIdsFromVariations(variations1);
    const ids2 = normalizeVariationIdsFromVariations(variations2);
    if (ids1.length !== ids2.length) return false;
    return ids1.every((id, index) => id === ids2[index]);
};

const areVariationCanonicalChainsEqual = (variations1 = [], variations2 = []) => {
    const chain1 = getVariationCanonicalChain(variations1);
    const chain2 = getVariationCanonicalChain(variations2);
    if (chain1.length !== chain2.length) return false;
    return chain1.every((id, index) => id === chain2[index]);
};

const normalizeEquivalentToIdsFromVariation = (variation) => {
    if (!variation || !Array.isArray(variation.equivalentTo)) return [];
    return variation.equivalentTo
        .map((entry) => {
            const rawId = entry != null && typeof entry === 'object' && entry._id != null ? entry._id : entry;
            return normalizeId(rawId);
        })
        .filter(Boolean);
};

const buildVariationByIdMapFromList = (variations = []) => {
    const map = new Map();
    for (const variation of flattenVariationList(variations)) {
        const ids = normalizeVariationIdsFromVariation(variation);
        for (const id of ids) {
            if (!map.has(id)) map.set(id, variation);
        }
    }
    return map;
};

const expandOneVariationId = (id, variationById, visited, result) => {
    const sid = normalizeId(id);
    if (!sid || visited.has(sid)) return;
    visited.add(sid);
    const doc = variationById.get(sid);
    const equivalentTo = normalizeEquivalentToIdsFromVariation(doc);
    if (equivalentTo.length >= 2) {
        for (const childId of equivalentTo) expandOneVariationId(childId, variationById, visited, result);
        return;
    }
    result.push(sid);
};

const resolveExpandedLeafVariationIds = (sourceVariations = [], variationById = null) => {
    const flat = flattenVariationList(sourceVariations);
    const byId = variationById || buildVariationByIdMapFromList(flat);
    const sourceIds = flat.flatMap((variation) => normalizeVariationIdsFromVariation(variation));
    const result = [];
    const visited = new Set();
    for (const id of sourceIds) expandOneVariationId(id, byId, visited, result);
    return [...new Set(result.map(normalizeId).filter(Boolean))].sort();
};

const getVariationExpandedSignature = (variations = []) => {
    const ids = resolveExpandedLeafVariationIds(variations);
    return ids.join('|');
};

const areVariationExpandedSignaturesEqual = (variations1 = [], variations2 = []) =>
    getVariationExpandedSignature(variations1) === getVariationExpandedSignature(variations2);

function label(doc) {
    return doc?.name?.fr || doc?.name?.en || String(doc?._id || '?');
}

async function resolveEquivalentNames(equivalentTo = []) {
    if (!Array.isArray(equivalentTo) || equivalentTo.length === 0) return [];
    const ids = equivalentTo.map((entry) => (
        entry != null && typeof entry === 'object' && entry._id != null ? entry._id : entry
    ));
    const docs = await Variation.find({ _id: { $in: ids } }, { name: 1 }).lean();
    const byId = new Map(docs.map((doc) => [String(doc._id), label(doc)]));
    return ids.map((id) => `${String(id)} (${byId.get(String(id)) || '?'})`);
}

function printComparison(title, incoming, existing) {
    const combinationEqual = areVariationCombinationsEqual(incoming, existing);
    const canonicalChainEqual = areVariationCanonicalChainsEqual(incoming, existing);
    const expandedSignatureEqual = areVariationExpandedSignaturesEqual(incoming, existing);
    console.log(`\n=== ${title} ===`);
    console.log('incoming ids:', normalizeVariationIdsFromVariations(incoming));
    console.log('existing ids:', normalizeVariationIdsFromVariations(existing));
    console.log('incoming expanded signature:', getVariationExpandedSignature(incoming));
    console.log('existing expanded signature:', getVariationExpandedSignature(existing));
    console.log('incoming canonical chain:', getVariationCanonicalChain(incoming));
    console.log('existing canonical chain:', getVariationCanonicalChain(existing));
    console.log('areVariationCombinationsEqual:', combinationEqual);
    console.log('areVariationCanonicalChainsEqual:', canonicalChainEqual);
    console.log('areVariationExpandedSignaturesEqual:', expandedSignatureEqual);
    console.log('=> duplicate blocked:', combinationEqual || canonicalChainEqual || expandedSignatureEqual);
    return { combinationEqual, canonicalChainEqual, expandedSignatureEqual };
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    }
    await mongoose.connect(mongoUrl + database);

    const ids = [EXTENSIONS_MOLLETS_ID, EXTENSION_MOLLETS_MACHINE_ID, BARRE_GUIDEE_ID, MACHINE_ID];
    const docs = await Variation.find(
        { _id: { $in: ids } },
        { name: 1, isExercice: 1, equivalentTo: 1 }
    ).lean();
    const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

    for (const id of ids) {
        if (!byId.has(id)) {
            throw new Error(`Variation introuvable: ${id}`);
        }
    }

    const extensionsMollets = byId.get(EXTENSIONS_MOLLETS_ID);
    const extensionMolletsMachine = byId.get(EXTENSION_MOLLETS_MACHINE_ID);
    const barreGuidee = byId.get(BARRE_GUIDEE_ID);
    const machine = byId.get(MACHINE_ID);

    console.log('=== Variations chargées ===');
    console.log('Extensions mollets:', label(extensionsMollets), EXTENSIONS_MOLLETS_ID);
    console.log('  equivalentTo:', await resolveEquivalentNames(extensionsMollets.equivalentTo));
    console.log('Extension mollets machine:', label(extensionMolletsMachine), EXTENSION_MOLLETS_MACHINE_ID);
    console.log('  equivalentTo:', await resolveEquivalentNames(extensionMolletsMachine.equivalentTo));
    console.log('Barre guidée:', label(barreGuidee), BARRE_GUIDEE_ID);
    console.log('Machine:', label(machine), MACHINE_ID);

    const existing = [extensionsMollets, barreGuidee];
    const incomingMachine = [extensionsMollets, machine];
    const comboMachine = [extensionMolletsMachine];
    const splitMachine = [extensionsMollets, machine];

    const result = printComparison(
        'Incoming Extensions mollets+Machine vs existing Extensions mollets+Barre guidée',
        incomingMachine,
        existing
    );

    const superiorEquivalence = printComparison(
        'Combo Extension mollets machine vs split Extensions mollets+Machine (équivalence supérieure)',
        comboMachine,
        splitMachine
    );

    printComparison(
        'Contrôle Extensions mollets+Barre guidée vs existing (doit être duplicate)',
        existing,
        existing
    );

    console.log('\n=== Synthèse ===');
    if (result.canonicalChainEqual && !result.combinationEqual && !result.expandedSignatureEqual) {
        console.log('ECHEC: faux positif via chaîne canonique — le détail matériel est encore ignoré.');
        process.exitCode = 1;
    } else if (!result.canonicalChainEqual && !result.combinationEqual && !result.expandedSignatureEqual) {
        console.log('OK: Extensions mollets+Machine accepté à côté de Extensions mollets+Barre guidée.');
    }

    if (!superiorEquivalence.expandedSignatureEqual) {
        console.log('ECHEC: combo vs split non détectés équivalents via signature expandue.');
        process.exitCode = 1;
    } else {
        console.log('OK: équivalence supérieure combo vs split détectée.');
    }

    await mongoose.disconnect();
}

run().catch(async (error) => {
    console.error('debugWorkoutDuplicateExtensionsMollets failed:', error);
    try {
        await mongoose.disconnect();
    } catch (_) {
        // ignore
    }
    process.exit(1);
});
