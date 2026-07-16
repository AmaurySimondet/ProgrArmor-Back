/**
 * Résolution musculaire alignée sur la vue séance (ProgArmorApp/utils/muscleWork.js).
 * Source de vérité backend — garder en sync avec le frontend.
 *
 * Règles :
 * - Si la chaîne contient un détail type Muscle → il prévaut (ignore l'exercice)
 * - Sinon ne compter que l'exercice principal (isExercice=true)
 * - Ignorer les autres détails (machine, prise, etc.)
 * - Fallback equivalentTo sur la/les cible(s) de résolution si pas de tags directs
 */
const { schema: { MUSCLE_TYPE_ID } } = require('../constants');

function normalizeId(id) {
    if (id === null || id === undefined) return null;
    return String(id);
}

function normalizeVariationIdsFromVariation(variation) {
    const rawId = variation?._id;
    if (Array.isArray(rawId)) {
        return [...new Set(rawId.map(normalizeId).filter(Boolean))].sort();
    }
    const normalized = normalizeId(rawId);
    return normalized ? [normalized] : [];
}

function getEquivalentToFirstId(variation) {
    if (!variation || !Array.isArray(variation.equivalentTo) || variation.equivalentTo.length === 0) {
        return null;
    }
    const first = variation.equivalentTo[0];
    const rawId = first != null && typeof first === 'object' && first._id != null ? first._id : first;
    return normalizeId(rawId);
}

function flattenVariationList(variations = []) {
    const result = [];
    for (const variation of variations || []) {
        if (!variation) continue;
        if (Array.isArray(variation.variations)) {
            result.push(...flattenVariationList(variation.variations));
        } else {
            result.push(variation);
        }
    }
    return result;
}

/**
 * Détermine l'exercice principal d'une liste de variations.
 * Priorité (miroir frontend utils/variations.js) :
 * 1) variation isExercice dont l'id correspond à equivalentTo[0]
 * 2) première variation isExercice
 * 3) null
 */
function getPrimaryExerciseVariationFromList(variations = []) {
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
}

function extractMuscleKeysFromVariation(variation) {
    const muscles = variation?.muscles;
    if (!muscles) return { primary: [], secondary: [], all: [] };
    const primary = Array.isArray(muscles.primary) ? muscles.primary.filter(Boolean) : [];
    const secondary = Array.isArray(muscles.secondary) ? muscles.secondary.filter(Boolean) : [];
    return { primary, secondary, all: [...primary, ...secondary] };
}

function extractMuscleKeys(variation) {
    return extractMuscleKeysFromVariation(variation).all;
}

function buildReverseEquivalentMuscleMap(canonicalVariations = []) {
    const map = new Map();
    for (const canonical of canonicalVariations) {
        const muscleKeys = extractMuscleKeys(canonical);
        if (muscleKeys.length === 0) continue;
        for (const legacyId of canonical.equivalentTo || []) {
            const id = String(legacyId);
            if (!map.has(id)) {
                map.set(id, muscleKeys);
            }
        }
    }
    return map;
}

function getVariationTypeId(variation) {
    const type = variation?.type;
    if (type == null) return null;
    if (typeof type === 'object' && type._id != null) return normalizeId(type._id);
    return normalizeId(type);
}

function isMuscleTypeDetail(variation) {
    if (!variation || variation.isExercice === true) return false;
    return getVariationTypeId(variation) === MUSCLE_TYPE_ID;
}

/**
 * Cibles de résolution musculaire pour une chaîne.
 * Détails type Muscle s'il y en a, sinon l'exercice principal.
 */
function getMuscleResolutionTargets(variations = []) {
    const flattened = flattenVariationList(variations);
    const muscleDetails = flattened.filter(isMuscleTypeDetail);
    if (muscleDetails.length > 0) return muscleDetails;

    const primaryExercise = getPrimaryExerciseVariationFromList(flattened);
    return primaryExercise ? [primaryExercise] : [];
}

function resolveMuscleKeysForVariation(variation, reverseEquivalentMap = new Map()) {
    const directKeys = extractMuscleKeys(variation);
    if (directKeys.length > 0) return directKeys;
    if (!variation?._id) return [];
    return reverseEquivalentMap.get(String(variation._id)) || [];
}

function resolveMusclesFromVariationChain(variations = [], reverseEquivalentMap = new Map()) {
    const targets = getMuscleResolutionTargets(variations);
    const primary = [];
    const secondary = [];
    const seen = new Set();

    const addUnique = (list, key) => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        list.push(key);
    };

    for (const target of targets) {
        const direct = extractMuscleKeysFromVariation(target);
        let primaryKeys = direct.primary;
        let secondaryKeys = direct.secondary;

        if (direct.all.length === 0) {
            primaryKeys = resolveMuscleKeysForVariation(target, reverseEquivalentMap);
            secondaryKeys = [];
        }

        for (const key of primaryKeys) addUnique(primary, key);
        for (const key of secondaryKeys) addUnique(secondary, key);
    }

    return {
        primary,
        secondary,
        all: [...primary, ...secondary.filter((key) => !primary.includes(key))],
    };
}

function getMusclesFromVariationChain(variations = [], reverseEquivalentMap = new Map()) {
    return resolveMusclesFromVariationChain(variations, reverseEquivalentMap).all;
}

function resolveVariationChainFromSet(set, variationById) {
    return (set.variations || [])
        .map((entry) => variationById.get(String(entry?.variation)))
        .filter(Boolean);
}

/**
 * Résout les muscles sollicités pour un SeanceSet.
 * Aligné sur buildSessionMuscleStates côté app (détail Muscle prévaut).
 */
function resolveMuscleKeysForSet(set, variationById, reverseEquivalentMap = new Map()) {
    const chain = resolveVariationChainFromSet(set, variationById);
    return getMusclesFromVariationChain(chain, reverseEquivalentMap);
}

module.exports = {
    getPrimaryExerciseVariationFromList,
    getMusclesFromVariationChain,
    resolveMusclesFromVariationChain,
    getMuscleResolutionTargets,
    isMuscleTypeDetail,
    resolveMuscleKeysForSet,
    resolveVariationChainFromSet,
    resolveMuscleKeysForVariation,
    extractMuscleKeys,
    extractMuscleKeysFromVariation,
    buildReverseEquivalentMuscleMap,
    flattenVariationList,
    MUSCLE_TYPE_ID,
};
