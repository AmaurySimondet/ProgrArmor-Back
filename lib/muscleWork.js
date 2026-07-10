/**
 * Résolution musculaire alignée sur la vue séance (ProgArmorApp/utils/muscleWork.js).
 * Source de vérité backend — garder en sync avec le frontend.
 *
 * Règles :
 * - Ne compter que l'exercice principal (isExercice=true) de chaque set
 * - Ignorer les détails de variation (isExercice=false)
 * - Fallback equivalentTo uniquement sur l'exercice principal
 */

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

function resolveMuscleKeysForVariation(variation, reverseEquivalentMap = new Map()) {
    const directKeys = extractMuscleKeys(variation);
    if (directKeys.length > 0) return directKeys;
    if (!variation?._id) return [];
    return reverseEquivalentMap.get(String(variation._id)) || [];
}

function getMusclesFromVariationChain(variations = [], reverseEquivalentMap = new Map()) {
    const primaryExercise = getPrimaryExerciseVariationFromList(variations);
    if (!primaryExercise) return [];
    return resolveMuscleKeysForVariation(primaryExercise, reverseEquivalentMap);
}

function resolveVariationChainFromSet(set, variationById) {
    return (set.variations || [])
        .map((entry) => variationById.get(String(entry?.variation)))
        .filter(Boolean);
}

/**
 * Résout les muscles sollicités pour un SeanceSet.
 * Ignore les détails isExercice=false — aligné sur buildSessionMuscleStates côté app.
 */
function resolveMuscleKeysForSet(set, variationById, reverseEquivalentMap = new Map()) {
    const chain = resolveVariationChainFromSet(set, variationById);
    return getMusclesFromVariationChain(chain, reverseEquivalentMap);
}

module.exports = {
    getPrimaryExerciseVariationFromList,
    getMusclesFromVariationChain,
    resolveMuscleKeysForSet,
    resolveVariationChainFromSet,
    resolveMuscleKeysForVariation,
    extractMuscleKeys,
    extractMuscleKeysFromVariation,
    buildReverseEquivalentMuscleMap,
    flattenVariationList,
};
