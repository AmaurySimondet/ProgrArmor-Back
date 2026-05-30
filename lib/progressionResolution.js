const mongoose = require('mongoose');
const Variation = require('../schema/variation');

const DEFAULT_REFERENCE_VARIATION_ID = '669c3609218324e0b7682b2b'; // tuck
const STREET_FIGURE_TYPE_ID = '669cee980c89e9434327caa8';
const TARGET_VARIATION_PROJECTION = {
    type: 1,
    equivalentTo: 1,
    isExercice: 1,
    progressionReferenceVariationId: 1,
};

function normalizeId(id) {
    if (id == null) return null;
    const str = String(id);
    return mongoose.Types.ObjectId.isValid(str) ? str : null;
}

function getEquivalentToFirstId(doc) {
    const first = doc?.equivalentTo?.[0];
    if (first == null) return null;
    return normalizeId(typeof first === 'object' && first._id != null ? first._id : first);
}

function pickFirstExerciseIdFromDocs(variationIds, variationById) {
    for (const id of variationIds || []) {
        const key = normalizeId(id);
        if (!key) continue;
        const doc = variationById?.get?.(key) ?? variationById?.[key];
        if (doc?.isExercice === true) return key;
    }
    return null;
}

function isStreetFigureType(docOrTypeId) {
    if (!docOrTypeId) return false;
    if (typeof docOrTypeId === 'string') {
        return String(docOrTypeId) === STREET_FIGURE_TYPE_ID;
    }
    const typeId = docOrTypeId?.type;
    if (typeId == null) return false;
    return String(typeId) === STREET_FIGURE_TYPE_ID;
}

/**
 * Ancre de famille (filtrage sets) : equivalentTo[0] → premier isExercice → soi-même.
 */
function resolveFamilyAnchorIdFromDoc(variationDoc) {
    if (!variationDoc) return null;
    const selfId = normalizeId(variationDoc._id);
    if (!selfId) return null;

    const eq0 = getEquivalentToFirstId(variationDoc);
    if (eq0) return eq0;

    if (variationDoc.isExercice === true) return selfId;
    return selfId;
}

async function resolveFamilyAnchorId({
    variationId = null,
    variationIds = null,
    variationDoc = null,
}) {
    if (variationDoc) {
        return resolveFamilyAnchorIdFromDoc(variationDoc);
    }

    const ids = Array.isArray(variationIds) && variationIds.length > 0
        ? variationIds.map((id) => normalizeId(id)).filter(Boolean)
        : (variationId ? [normalizeId(variationId)].filter(Boolean) : []);

    if (ids.length === 0) return null;

    const docs = await Variation.find(
        { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
        { equivalentTo: 1, isExercice: 1 }
    ).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    if (ids.length === 1) {
        return resolveFamilyAnchorIdFromDoc(byId.get(ids[0]));
    }

    const exerciseFirst = pickFirstExerciseIdFromDocs(ids, byId);
    if (exerciseFirst) return exerciseFirst;

    const primaryId = ids[0];
    return resolveFamilyAnchorIdFromDoc(byId.get(primaryId)) || primaryId;
}

/**
 * Cible de normalisation (axe graphe) :
 * progressionReferenceVariationId → tuck si street figure → equivalentTo[0] → premier isExercice → soi.
 */
async function resolveTargetVariationId({
    variationId = null,
    variationIds = null,
    variationDoc = null,
    explicitReferenceId = null,
}) {
    const explicit = normalizeId(explicitReferenceId);
    if (explicit) return explicit;

    const ids = Array.isArray(variationIds) && variationIds.length > 0
        ? variationIds.map((id) => normalizeId(id)).filter(Boolean)
        : [];

    const primaryId = normalizeId(variationId) || ids[0] || null;
    let doc = variationDoc;
    let variationById = null;

    if (!doc) {
        if (ids.length > 1) {
            const docs = await Variation.find(
                { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
                TARGET_VARIATION_PROJECTION,
            ).lean();
            variationById = new Map(docs.map((d) => [String(d._id), d]));
            doc = (primaryId && variationById.get(primaryId)) || docs[0] || null;
        } else if (primaryId) {
            doc = await Variation.findById(primaryId, TARGET_VARIATION_PROJECTION).lean();
        }
    } else if (ids.length > 1) {
        variationById = new Map([[String(doc._id), doc]]);
        const missingIds = ids.filter((id) => !variationById.has(id));
        if (missingIds.length > 0) {
            const docs = await Variation.find(
                { _id: { $in: missingIds.map((id) => new mongoose.Types.ObjectId(id)) } },
                TARGET_VARIATION_PROJECTION,
            ).lean();
            for (const fetched of docs) {
                variationById.set(String(fetched._id), fetched);
            }
        }
    }

    if (!doc) return primaryId;

    const progressionRef = normalizeId(doc.progressionReferenceVariationId);
    if (progressionRef) return progressionRef;

    if (isStreetFigureType(doc)) {
        return DEFAULT_REFERENCE_VARIATION_ID;
    }

    const eq0 = getEquivalentToFirstId(doc);
    if (eq0) return eq0;

    if (ids.length > 1) {
        if (!variationById) {
            variationById = new Map([[String(doc._id), doc]]);
            const missingIds = ids.filter((id) => !variationById.has(id));
            if (missingIds.length > 0) {
                const docs = await Variation.find(
                    { _id: { $in: missingIds.map((id) => new mongoose.Types.ObjectId(id)) } },
                    TARGET_VARIATION_PROJECTION,
                ).lean();
                for (const fetched of docs) {
                    variationById.set(String(fetched._id), fetched);
                }
            }
        }
        const exerciseFirst = pickFirstExerciseIdFromDocs(ids, variationById);
        if (exerciseFirst) return exerciseFirst;
    }

    return normalizeId(doc._id) || primaryId;
}

/** Alias historique : même logique qu'ancre famille. */
async function resolveMainExerciseIdForProgression(mainExerciseId) {
    if (!mainExerciseId) return null;
    return resolveFamilyAnchorId({ variationId: mainExerciseId });
}

async function resolveGraphContextVariationId(normalizedMainExerciseId) {
    if (!normalizedMainExerciseId || !mongoose.Types.ObjectId.isValid(String(normalizedMainExerciseId))) {
        return normalizedMainExerciseId ? String(normalizedMainExerciseId) : null;
    }
    const idStr = String(normalizedMainExerciseId);
    const doc = await Variation.findById(idStr, { progressionReferenceVariationId: 1 }).lean();
    const refId = doc?.progressionReferenceVariationId != null
        ? String(doc.progressionReferenceVariationId)
        : null;
    if (refId && mongoose.Types.ObjectId.isValid(refId)) {
        return refId;
    }
    return idStr;
}

async function resolveReferenceVariationIdsForProgression({
    referenceVariations,
    mainExerciseId,
    parseVariationIdsFromControllerInput,
}) {
    const explicitIds = parseVariationIdsFromControllerInput(referenceVariations);
    if (explicitIds.length > 0) return explicitIds;

    const anchorId = await resolveFamilyAnchorId({ variationId: mainExerciseId });
    if (!anchorId) {
        return [];
    }

    const targetId = await resolveTargetVariationId({ variationId: anchorId });
    if (targetId) {
        return [targetId];
    }

    return [anchorId];
}

const LATERAL_MODES = new Set(['bilateral', 'left', 'right']);

function normalizeLateralMode(value) {
    const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return LATERAL_MODES.has(mode) ? mode : 'bilateral';
}

function setMatchesLateralMode(setDoc, lateralMode) {
    const mode = normalizeLateralMode(lateralMode);
    const isUnilateral = setDoc?.isUnilateral === true;
    if (mode === 'bilateral') {
        return !isUnilateral;
    }
    if (!isUnilateral) return false;
    const side = setDoc?.unilateralSide === 'right' ? 'right' : 'left';
    return side === mode;
}

function filterSetsByLateralMode(sets, lateralMode) {
    if (!Array.isArray(sets)) return [];
    return sets.filter((setDoc) => setMatchesLateralMode(setDoc, lateralMode));
}

function computeLateralAvailability(sets) {
    let hasBilateralSets = false;
    let hasLeftSets = false;
    let hasRightSets = false;
    for (const setDoc of sets || []) {
        if (setDoc?.isUnilateral === true) {
            if (setDoc?.unilateralSide === 'right') hasRightSets = true;
            else hasLeftSets = true;
        } else {
            hasBilateralSets = true;
        }
    }
    return { hasBilateralSets, hasLeftSets, hasRightSets };
}

function parseIncludedVariationIds(raw) {
    if (raw == null) return null;
    const list = Array.isArray(raw) ? raw : [raw];
    const ids = list
        .flatMap((entry) => String(entry).split(','))
        .map((id) => normalizeId(id.trim()))
        .filter(Boolean);
    return [...new global.Set(ids)];
}

/**
 * Parse excluded signatures to keep the exact format:
 * signatures are strings like "id1|id2|id3".
 *
 * null/undefined => pas de filtre
 * []/string vide => aucun match exclu
 */
function parseExcludedVariationSignatures(raw) {
    if (raw == null) return null;
    const list = Array.isArray(raw) ? raw : [raw];
    const ids = list
        .flatMap((entry) => String(entry).split(','))
        .map((id) => String(id).trim())
        .filter(Boolean);
    return [...new global.Set(ids)];
}

function filterSetsByIncludedVariationIds(sets, includedVariationIds, getVariationIdsFromSetDoc) {
    if (!Array.isArray(includedVariationIds)) {
        return sets;
    }
    if (includedVariationIds.length === 0) {
        return [];
    }
    const allowed = new global.Set(includedVariationIds.map((id) => String(id)));
    return (sets || []).filter((setDoc) => {
        const ids = getVariationIdsFromSetDoc(setDoc);
        return ids.some((id) => allowed.has(String(id)));
    });
}

/** null/undefined = pas de filtre ; liste (éventuellement vide) = filtre actif. */
function applyIncludedVariationIdsFilter(sets, includedVariationIds, getVariationIdsFromSetDoc) {
    if (includedVariationIds === undefined || includedVariationIds === null) {
        return sets;
    }
    const parsed = parseIncludedVariationIds(includedVariationIds);
    return filterSetsByIncludedVariationIds(sets, parsed || [], getVariationIdsFromSetDoc);
}

module.exports = {
    DEFAULT_REFERENCE_VARIATION_ID,
    STREET_FIGURE_TYPE_ID,
    LATERAL_MODES,
    isStreetFigureType,
    resolveFamilyAnchorId,
    resolveTargetVariationId,
    resolveMainExerciseIdForProgression,
    resolveGraphContextVariationId,
    resolveReferenceVariationIdsForProgression,
    normalizeLateralMode,
    setMatchesLateralMode,
    filterSetsByLateralMode,
    computeLateralAvailability,
    parseIncludedVariationIds,
    parseExcludedVariationSignatures,
    filterSetsByIncludedVariationIds,
    applyIncludedVariationIdsFilter,
};
