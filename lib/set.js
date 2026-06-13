const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
const Seance = require('../schema/seance');
require('dotenv').config();
const {
    compareAndAssignPR,
    getEffectiveLoad,
    getEffectiveLoadPreferringPersisted,
    filterSetsAtSameEffectiveLoad,
    getReferenceBestSetAtSameLoad,
    maxEffectiveLoadAmongSets,
    maxValueAmongSets,
    resolvePrComparisonOneRmKg,
    LOAD_EPSILON,
} = require('../utils/set');
const {
    normalizeSessionSetsForPrEvaluation,
    filterSessionPeersWithStrongerOneRm,
} = require('../utils/prSessionSets');
const { mergePersistedOptionalFieldsFromClient, KG_TO_LB, round2 } = require('../utils/seanceSetPersistedFields');
const Variation = require('../schema/variation');
const UserMeasure = require('../schema/userMeasure');
const { buildMyExercisesSearchCompound } = require('./variationSearchPipelines');
const {
    resolveUserWeightKgForDate,
    resolveUserHeightMultiplierForDate,
} = require('../utils/userMeasureTimeline');
const {
    secondsToEquivalentReps,
    shouldUseBrzyckiForRepsEquivalent,
    getEffectiveLoadKg,
    computeSetOneRepMaxEstimates,
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley,
    mapSetWithPeakOneRmEstimates,
    resolveAggregateNormalizedOneRm,
    resolveNormalizedOneRmForRecommendation,
} = require('../utils/oneRepMax');
const {
    getDifficultyRatio,
    buildCanonicalVariationMap,
    resolveCanonicalVariationIdFromIds,
    toSortedSignature,
    buildAdjacencyList
} = require('./variationDifficultyGraph');
const VariationProgressionEdge = require('../schema/variationProgressionEdge');
const { computeStrengthPeakFromFigurePoints, buildStrengthPeaksBySignature } = require('./strengthPeak');
const {
    computeCardioPrsFromSets,
    evaluateCardioPersonalRecord,
    enrichCardioPrSlotsWithPeakDiff,
    computeCardioPeakFromPoints,
    buildCardioPeaksBySignature,
    mapSetToCardioPoint,
    isCardioScopeSets,
    filterCardioSets,
    shouldUseCardioPrPath,
    isCardioVariationDoc,
} = require('./cardioMetrics');
const {
    resolveFamilyAnchorId,
    resolveTargetVariationId,
    resolveMainExerciseIdForProgression,
    resolveGraphContextVariationId,
    resolveReferenceVariationIdsForProgression: resolveReferenceVariationIdsForProgressionCore,
    normalizeLateralMode,
    filterSetsByLateralMode,
    computeLateralAvailability,
    parseIncludedVariationIds,
    parseExcludedVariationSignatures,
    filterSetsByIncludedVariationIds,
    applyIncludedVariationIdsFilter,
} = require('./progressionResolution');
const {
    search: { SEARCH_MAX_TIME_MS },
    set: {
        PR_CATEGORIES,
        NORMAL_FLOW_FAMILY_MAX_DEPTH,
        NORMAL_FLOW_MAX_FAMILIES
    }
} = require('../constants');

function getSortedVariationIds(variationIds = []) {
    return variationIds.map(id => id.toString()).sort();
}

function getVariationSignature(variationIds = []) {
    return getSortedVariationIds(variationIds).join('|');
}

function resolveFamilySeedIds(rootVariationId, rootVariationDoc) {
    const fallbackId = rootVariationId ? String(rootVariationId) : null;
    const equivalentToPath = Array.isArray(rootVariationDoc?.equivalentTo)
        ? rootVariationDoc.equivalentTo.map((id) => String(id)).filter(Boolean)
        : [];
    if (equivalentToPath.length > 0) {
        return equivalentToPath;
    }
    return fallbackId ? [fallbackId] : [];
}

/**
 * Multi-sélection stats : chemin equivalentTo de l'exercice + morphologies hors chemin.
 * @param {string[]} orderedInputVariationIds — exercices en tête (tri stable amont)
 * @param {Map<string, object>} variationById — docs { isExercice, equivalentTo }
 * @returns {string[]}
 */
function resolveMultiInputFamilySeedIds(orderedInputVariationIds, variationById) {
    const ordered = (Array.isArray(orderedInputVariationIds) ? orderedInputVariationIds : [])
        .map((id) => String(id))
        .filter(Boolean);
    if (!ordered.length) return [];

    const primaryExerciseId = ordered.find(
        (id) => variationById.get(id)?.isExercice === true,
    ) || ordered[0];
    const primaryDoc = variationById.get(String(primaryExerciseId)) || null;
    const baseSeeds = resolveFamilySeedIds(String(primaryExerciseId), primaryDoc);
    const seen = new global.Set(baseSeeds.map(String));
    const familySeedIds = [...baseSeeds];

    for (const id of ordered) {
        if (seen.has(id)) continue;
        familySeedIds.push(id);
        seen.add(id);
    }
    return familySeedIds;
}

function buildVariationPrefixes(seedIds = [], maxDepth = undefined) {
    const normalized = (Array.isArray(seedIds) ? seedIds : [seedIds])
        .map((id) => String(id))
        .filter(Boolean);
    if (!normalized.length) return [];
    const limit = Number.isFinite(Number(maxDepth))
        ? Math.max(1, Math.min(Math.floor(Number(maxDepth)), normalized.length))
        : normalized.length;
    const prefixes = [];
    for (let depth = 1; depth <= limit; depth += 1) {
        prefixes.push(normalized.slice(0, depth));
    }
    return prefixes;
}

function normalizeEquivalentToIds(doc) {
    if (!doc || !Array.isArray(doc.equivalentTo)) return [];
    return doc.equivalentTo.map((id) => String(id)).filter(Boolean);
}

function getVariationDocFromMap(variationById, id) {
    const sid = String(id);
    return variationById?.get?.(sid) ?? variationById?.[sid] ?? null;
}

function expandOneVariationId(id, variationById, visited, result) {
    const sid = String(id);
    if (!sid || visited.has(sid)) return;
    visited.add(sid);

    const doc = getVariationDocFromMap(variationById, sid);
    const equivalentTo = normalizeEquivalentToIds(doc);

    if (equivalentTo.length >= 2) {
        for (const childId of equivalentTo) {
            expandOneVariationId(childId, variationById, visited, result);
        }
        return;
    }

    result.push(sid);
}

/**
 * Déplie récursivement les compositions (equivalentTo.length >= 2) en IDs feuilles triés.
 */
function resolveExpandedLeafVariationIds(sourceVariationIds, variationById, visited = null) {
    const result = [];
    const seenInWalk = visited || new global.Set();

    for (const rawId of (sourceVariationIds || [])) {
        expandOneVariationId(String(rawId), variationById, seenInWalk, result);
    }

    return getSortedVariationIds([...new global.Set(result)]);
}

async function loadVariationByIdClosure(seedIds = [], extraFields = { equivalentTo: 1, isExercice: 1, verified: 1, name: 1 }) {
    const pending = new global.Set(
        (Array.isArray(seedIds) ? seedIds : [seedIds])
            .map((id) => String(id))
            .filter(Boolean),
    );
    const variationById = new Map();

    while (pending.size > 0) {
        const batch = [...pending].filter((id) => !variationById.has(id));
        pending.clear();
        if (batch.length === 0) break;

        const validOids = batch
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        if (validOids.length === 0) continue;

        const docs = await Variation.find({ _id: { $in: validOids } }, extraFields).lean();
        for (const doc of docs) {
            const docId = String(doc._id);
            variationById.set(docId, doc);
            for (const refId of normalizeEquivalentToIds(doc)) {
                if (!variationById.has(refId)) {
                    pending.add(refId);
                }
            }
        }
    }

    return variationById;
}

async function findVerifiedCombosContainedInExpandedLeaves(expandedLeafIds) {
    if (!expandedLeafIds.length) return [];
    const expandedObjectIds = expandedLeafIds.map((id) => new mongoose.Types.ObjectId(id));
    return Variation.find(
        {
            verified: true,
            'equivalentTo.1': { $exists: true },
            equivalentTo: { $not: { $elemMatch: { $nin: expandedObjectIds } } },
        },
        { _id: 1, equivalentTo: 1 },
    ).lean();
}

function buildEquivalentLoggingGroupsFromExpandedLeaves(expandedLeafIds, verifiedCombos = []) {
    const uniqueGroups = new Map();
    const addGroup = (group) => {
        const sorted = getSortedVariationIds(group);
        if (sorted.length === 0) return;
        uniqueGroups.set(getVariationSignature(sorted), sorted);
    };

    addGroup(expandedLeafIds);

    const leafSet = new global.Set(expandedLeafIds);
    for (const combo of verifiedCombos) {
        const comboId = String(combo._id);
        const eqIds = getSortedVariationIds(combo.equivalentTo || []);
        if (eqIds.length < 2) continue;
        if (!eqIds.every((leafId) => leafSet.has(leafId))) continue;

        if (eqIds.length === expandedLeafIds.length) {
            addGroup([comboId]);
            continue;
        }

        const eqIdSet = new global.Set(eqIds);
        const remainder = expandedLeafIds.filter((leafId) => !eqIdSet.has(leafId));
        addGroup([comboId, ...remainder]);
    }

    return Array.from(uniqueGroups.values());
}

async function getAlternativeVariationGroups(variationIds = []) {
    const baseIds = getSortedVariationIds(variationIds);
    const uniqueGroups = new Map();
    const addGroup = (group) => {
        const sorted = getSortedVariationIds(group);
        if (sorted.length === 0) return;
        uniqueGroups.set(getVariationSignature(sorted), sorted);
    };

    if (baseIds.length === 0) {
        return [];
    }

    addGroup(baseIds);

    const variationById = await loadVariationByIdClosure(baseIds);
    const expandedLeafIds = resolveExpandedLeafVariationIds(baseIds, variationById);
    addGroup(expandedLeafIds);

    const verifiedCombos = await findVerifiedCombosContainedInExpandedLeaves(expandedLeafIds);
    for (const altGroup of buildEquivalentLoggingGroupsFromExpandedLeaves(expandedLeafIds, verifiedCombos)) {
        addGroup(altGroup);
    }

    const baseObjectIds = baseIds.map((id) => new mongoose.Types.ObjectId(id));

    const equivalentVerifiedVariations = await Variation.find(
        {
            verified: true,
            equivalentTo: {
                $size: baseIds.length,
                $all: baseObjectIds,
            },
        },
        { _id: 1 },
    );

    for (const variation of equivalentVerifiedVariations) {
        addGroup([variation._id.toString()]);
    }

    if (baseIds.length === 1) {
        const baseObjectId = new mongoose.Types.ObjectId(baseIds[0]);
        const variationMeta = variationById.get(baseIds[0])
            || await Variation.findById(
                baseObjectId,
                { verified: 1, equivalentTo: 1, isExercice: 1, name: 1 },
            ).lean();

        if (variationMeta?.equivalentTo?.length) {
            addGroup(getSortedVariationIds(variationMeta.equivalentTo));
        }

        if (variationMeta?.isExercice !== true) {
            const reverseCanonicalGroups = await Variation.find(
                {
                    verified: true,
                    equivalentTo: baseObjectId,
                },
                { equivalentTo: 1 },
            ).lean();
            for (const doc of reverseCanonicalGroups) {
                addGroup(getSortedVariationIds(doc?.equivalentTo || []));
            }
        }
    }

    return Array.from(uniqueGroups.values());
}

function buildVariationsExactMatchQuery(variationGroups = []) {
    const groups = variationGroups.filter(group => Array.isArray(group) && group.length > 0);

    if (groups.length === 0) {
        return null;
    }

    const conditions = groups.map(group => ({
        variations: {
            $size: group.length,
            $all: group.map(id => ({ $elemMatch: { variation: new mongoose.Types.ObjectId(id) } }))
        }
    }));

    if (conditions.length === 1) {
        return conditions[0];
    }

    return { $or: conditions };
}

function buildVariationsContainmentQuery(variationGroups = []) {
    const groups = variationGroups.filter(group => Array.isArray(group) && group.length > 0);

    if (groups.length === 0) {
        return null;
    }

    const conditions = groups.map(group => ({
        variations: {
            $all: group.map(id => ({ $elemMatch: { variation: new mongoose.Types.ObjectId(id) } }))
        }
    }));

    if (conditions.length === 1) {
        return conditions[0];
    }

    return { $or: conditions };
}

async function getEquivalentVerifiedMapFromGroups(variationGroups = []) {
    const uniqueGroupsBySignature = new Map();

    for (const group of variationGroups) {
        const sortedIds = getSortedVariationIds(group);
        if (sortedIds.length === 0) continue;
        const signature = sortedIds.join('|');
        if (!uniqueGroupsBySignature.has(signature)) {
            uniqueGroupsBySignature.set(signature, sortedIds);
        }
    }

    if (uniqueGroupsBySignature.size === 0) {
        return new Map();
    }

    const allSeedIds = [...new global.Set(Array.from(uniqueGroupsBySignature.values()).flat())];
    const variationById = await loadVariationByIdClosure(allSeedIds);
    const expandedEntries = [];
    for (const sortedIds of uniqueGroupsBySignature.values()) {
        const expandedIds = resolveExpandedLeafVariationIds(sortedIds, variationById);
        expandedEntries.push({
            signature: getVariationSignature(expandedIds),
            ids: expandedIds,
        });
    }
    for (const entry of expandedEntries) {
        if (!uniqueGroupsBySignature.has(entry.signature)) {
            uniqueGroupsBySignature.set(entry.signature, entry.ids);
        }
    }

    const equivalentConditions = Array.from(uniqueGroupsBySignature.values()).map(sortedIds => ({
        equivalentTo: {
            $size: sortedIds.length,
            $all: sortedIds.map(id => new mongoose.Types.ObjectId(id))
        }
    }));

    const equivalentVariations = await Variation.find(
        {
            verified: true,
            $or: equivalentConditions
        },
        { mergedNamesEmbedding: 0 }
    ).sort({ popularity: -1, createdAt: 1 });

    const equivalentBySignature = new Map();

    for (const equivalentVariation of equivalentVariations) {
        const signature = getVariationSignature(equivalentVariation.equivalentTo || []);
        if (!equivalentBySignature.has(signature)) {
            equivalentBySignature.set(signature, equivalentVariation);
        }
    }

    return equivalentBySignature;
}

/**
 * Fetches all sets given parameters.
 * @param {string} userId - The ID of the user.
 * @param {string} excludedSeanceId - The ID of the seance to exclude.
 * @param {string} seanceId - The ID of the seance.
 * @param {string} exercice - The ID of the exercice.
 * @param {string} categories - The ID of the categories.
 * @param {string} unit - The unit of the value.
 * @param {string} value - The value of the set.
 * @param {string} weightLoad - The weight load of the set.
 * @param {string} elastic - The elastic of the set.
 * @param {string} dateMin - The minimum date of the set.
 * @param {string} dateMax - The maximum date of the set.
 * @param {string} fields - Optional fields to include in the response
 * @param {string} variations - Optional variations to filter by
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of set objects.
 */
async function getSets(
    userId,
    excludedSeanceId,
    seanceId,
    exercice,
    categories,
    unit,
    value,
    weightLoad,
    elasticTension,
    dateMin,
    dateMax,
    fields,
    variations,
    unilateralSide,
    isUnilateral,
    valueMin,
    valueMax
) {
    try {
        const query = {};
        if (userId) {
            query.user = new mongoose.Types.ObjectId(userId);
        }
        if (excludedSeanceId) {
            query.seance = { $ne: new mongoose.Types.ObjectId(excludedSeanceId) };
        }
        if (seanceId) {
            query.seance = new mongoose.Types.ObjectId(seanceId);
        }
        if (exercice) {
            query.exercice = new mongoose.Types.ObjectId(exercice);
        }
        if (categories) {
            let categoriesJson = categories.map(c => JSON.parse(c));
            if (!Array.isArray(categoriesJson)) {
                categoriesJson = [categoriesJson];
            }

            const categoryIds = categoriesJson.map(c => new mongoose.Types.ObjectId(c.category));

            query.categories = {
                $size: categoryIds.length,
                $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
            };
        }
        if (variations) {
            let variationsJson;

            if (typeof variations[0] === 'string') {
                variationsJson = variations.map(v => JSON.parse(v));
            } else {
                variationsJson = variations;
            }

            if (!Array.isArray(variationsJson)) {
                variationsJson = [variationsJson];
            }

            const variationIds = variationsJson.map(v => v.variation);
            const variationGroups = await getAlternativeVariationGroups(variationIds);
            const variationQuery = buildVariationsExactMatchQuery(variationGroups);

            if (variationQuery?.$or) {
                query.$or = variationQuery.$or;
            } else if (variationQuery?.variations) {
                query.variations = variationQuery.variations;
            }
        }
        if (unit) {
            query.unit = unit;
        }
        if (value) {
            query.value = JSON.parse(value);
        }
        if (valueMin !== undefined || valueMax !== undefined) {
            const valueRange = query.value != null && typeof query.value === 'object' && !Array.isArray(query.value)
                ? { ...query.value }
                : {};
            if (valueMin !== undefined && valueMin !== null && valueMin !== '') {
                const parsedValueMin = Number(valueMin);
                if (Number.isFinite(parsedValueMin)) {
                    valueRange.$gt = parsedValueMin;
                }
            }
            if (valueMax !== undefined && valueMax !== null && valueMax !== '') {
                const parsedValueMax = Number(valueMax);
                if (Number.isFinite(parsedValueMax)) {
                    valueRange.$lt = parsedValueMax;
                }
            }
            if (Object.keys(valueRange).length > 0) {
                query.value = valueRange;
            }
        }
        if (weightLoad) {
            query.weightLoad = JSON.parse(weightLoad);
        }
        if (elasticTension) {
            query['elastic.tension'] = JSON.parse(elasticTension);
        }
        if (dateMin) {
            if (dateMax) {
                query.date = { $gte: new Date(dateMin), $lte: new Date(dateMax) };
            }
            else {
                query.date = { $gte: new Date(dateMin) };
            }
        }
        if (dateMax) {
            query.date = { $lte: new Date(dateMax) };
        }
        if (unilateralSide !== undefined) {
            query.unilateralSide = unilateralSide;
        }
        if (isUnilateral !== undefined) {
            query.isUnilateral = isUnilateral;
        }
        const sets = await Set.find(query)
            .sort({
                date: 1,
                exerciceOrder: 1,
                setOrder: 1
            })
            .exec();
        return sets;
    } catch (err) {
        console.error("Error fetching sets:", err);
        throw err;
    }
}

function getVariationIdsFromSetDoc(setDoc) {
    return (setDoc?.variations || [])
        .map((v) => (v?.variation != null ? String(v.variation) : null))
        .filter(Boolean);
}

/**
 * Déplie les compositions (equivalentTo) pour unifier le graphe
 * ex. set "Dips anneaux" vs "Dips + Anneaux", ou "Extensions mollets machine" vs "Extensions mollets + Machine".
 */
function resolveChartSourceVariationIds(sourceVariationIds, variationById) {
    return resolveExpandedLeafVariationIds(sourceVariationIds, variationById);
}

function resolveSetProgressionSignature(setDoc, variationById) {
    const rawIds = getVariationIdsFromSetDoc(setDoc);
    if (!rawIds.length) return null;
    const sourceVariationIds = resolveChartSourceVariationIds(rawIds, variationById);
    if (!sourceVariationIds.length) return null;
    return toSortedSignature(sourceVariationIds);
}

function filterSetsByExactProgressionSignature(sets, targetSignature, variationById) {
    if (!targetSignature) return [];
    const target = String(targetSignature);
    return (sets || []).filter((setDoc) => resolveSetProgressionSignature(setDoc, variationById) === target);
}

async function buildVariationByIdMapFromSetsAsync(sets, extraIds = []) {
    const allVariationIds = new global.Set();
    for (const setDoc of sets || []) {
        for (const id of getVariationIdsFromSetDoc(setDoc)) {
            allVariationIds.add(String(id));
        }
    }
    for (const id of extraIds || []) {
        if (id) allVariationIds.add(String(id));
    }
    if (!allVariationIds.size) {
        return new Map();
    }
    const docs = await Variation.find(
        { _id: { $in: Array.from(allVariationIds).map((id) => new mongoose.Types.ObjectId(id)) } },
        { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1, name: 1, equivalentTo: 1, type: 1, defaultMode: 1 }
    ).lean();
    return new Map(docs.map((doc) => [String(doc._id), doc]));
}

function buildLocalizedLabelFromVariationIds(variationIds = [], variationById = new Map()) {
    const frParts = [];
    const enParts = [];
    for (const id of variationIds || []) {
        const doc = variationById.get(String(id));
        frParts.push(doc?.name?.fr || doc?.name?.en || String(id));
        enParts.push(doc?.name?.en || doc?.name?.fr || String(id));
    }
    return {
        fr: frParts.filter(Boolean).join(' + ') || null,
        en: enParts.filter(Boolean).join(' + ') || null,
    };
}

function normalizeComboLabelDedupeKey(label) {
    return String(label || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/** Libellé combo (exercice puis détails, virgules) aligné sur l’UI workout/profil. */
function buildComboLocalizedLabelFromVariationIds(variationIds = [], variationById = new Map()) {
    const exerciseLabels = [];
    const detailLabels = [];
    const seenFr = new global.Set();
    for (const id of variationIds || []) {
        const doc = variationById.get(String(id));
        const fr = doc?.name?.fr || doc?.name?.en;
        const en = doc?.name?.en || doc?.name?.fr;
        if (!fr && !en) continue;
        const frKey = normalizeComboLabelDedupeKey(fr || en);
        if (frKey && seenFr.has(frKey)) continue;
        if (frKey) seenFr.add(frKey);
        const label = { fr: fr || en, en: en || fr };
        if (doc?.isExercice === true) exerciseLabels.push(label);
        else detailLabels.push(label);
    }
    const ordered = [...exerciseLabels, ...detailLabels];
    if (!ordered.length) {
        return buildLocalizedLabelFromVariationIds(variationIds, variationById);
    }
    return {
        fr: ordered.map((entry) => entry.fr).filter(Boolean).join(', '),
        en: ordered.map((entry) => entry.en).filter(Boolean).join(', '),
    };
}

function pickBestMergedVariationName(mergedNameCounts = new Map()) {
    const best = [...mergedNameCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const label = String(best[0]).trim();
    return label ? { fr: label, en: null } : null;
}

function buildReferenceVariationLabelForStrengthPeak(targetVariationIds, variationById, referencePoints = []) {
    const mergedNameFrCounts = new Map();
    const mergedNameEnCounts = new Map();
    for (const point of referencePoints || []) {
        const mergedFr = typeof point?.mergedVariationsNames?.fr === 'string'
            ? point.mergedVariationsNames.fr.trim()
            : '';
        if (mergedFr) {
            mergedNameFrCounts.set(mergedFr, (mergedNameFrCounts.get(mergedFr) || 0) + 1);
        }
        const mergedEn = typeof point?.mergedVariationsNames?.en === 'string'
            ? point.mergedVariationsNames.en.trim()
            : '';
        if (mergedEn) {
            mergedNameEnCounts.set(mergedEn, (mergedNameEnCounts.get(mergedEn) || 0) + 1);
        }
    }
    const bestMergedFr = pickBestMergedVariationName(mergedNameFrCounts);
    const bestMergedEn = pickBestMergedVariationName(mergedNameEnCounts);
    const sourceVariationIds = resolveChartSourceVariationIds(targetVariationIds, variationById);
    const fallback = buildLocalizedLabelFromVariationIds(sourceVariationIds, variationById);
    return {
        fr: bestMergedFr?.fr || fallback.fr,
        en: bestMergedEn?.fr || fallback.en,
    };
}

async function filterProgressionFamilySetsForPrs({
    rawSets,
    normalizedMainExerciseId,
    normalizedLateralMode,
    includedVariationIds,
    excludedVariationSignatures,
}) {
    let filteredSets = await filterSetsToMainExerciseFamily(rawSets, normalizedMainExerciseId);
    filteredSets = filterSetsByLateralMode(filteredSets, normalizedLateralMode);
    if (includedVariationIds != null) {
        filteredSets = applyIncludedVariationIdsFilter(
            filteredSets,
            includedVariationIds,
            getVariationIdsFromSetDoc
        );
    }
    if (excludedVariationSignatures != null) {
        const parsedExcluded = parseExcludedVariationSignatures(excludedVariationSignatures) || [];
        const excludedSet = new global.Set(parsedExcluded.map((s) => String(s)));
        if (excludedSet.size > 0) {
            const variationByIdForPolicy = await buildVariationByIdMapFromSetsAsync(filteredSets);
            filteredSets = (filteredSets || []).filter((setDoc) => {
                const signature = resolveSetProgressionSignature(setDoc, variationByIdForPolicy);
                return signature && !excludedSet.has(signature);
            });
        }
    }
    return filteredSets;
}

/**
 * Résout une référence contextualisée à la famille du main exercise.
 * Exemple: référence "tuck" + main "front lever" => "tuck front lever" (si variation vérifiée existe).
 * Permet d'unifier les sets saisis en format [main+detail] et ceux saisis via variation combinée.
 */
async function resolveContextualReferenceVariationId(referenceVariationId, normalizedMainExerciseId) {
    const refId = mongoose.Types.ObjectId.isValid(referenceVariationId)
        ? String(referenceVariationId)
        : null;
    if (!refId) return null;
    const mainId = mongoose.Types.ObjectId.isValid(normalizedMainExerciseId)
        ? String(normalizedMainExerciseId)
        : null;
    if (!mainId || mainId === refId) return refId;

    const contextual = await Variation.findOne(
        {
            verified: true,
            equivalentTo: {
                $size: 2,
                $all: [
                    new mongoose.Types.ObjectId(mainId),
                    new mongoose.Types.ObjectId(refId)
                ]
            }
        },
        { _id: 1 }
    )
        .sort({ popularity: -1, createdAt: 1 })
        .lean();

    return contextual?._id ? String(contextual._id) : refId;
}

async function resolveContextualSourceVariationId({
    sourceVariationIds,
    normalizedMainExerciseId,
    cache
}) {
    const ids = (sourceVariationIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length) return null;
    const signature = toSortedSignature(ids);
    if (cache?.has(signature)) return cache.get(signature);

    const mainId = mongoose.Types.ObjectId.isValid(normalizedMainExerciseId)
        ? String(normalizedMainExerciseId)
        : null;

    let contextual = null;
    const objectIds = ids
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    if (objectIds.length === ids.length && ids.length > 1) {
        contextual = await Variation.findOne(
            {
                equivalentTo: {
                    $size: ids.length,
                    $all: objectIds
                }
            },
            { _id: 1, verified: 1, popularity: 1, createdAt: 1 }
        )
            .sort({ verified: -1, popularity: -1, createdAt: 1 })
            .lean();
    }

    if (!contextual && mainId && ids.length === 1 && ids[0] !== mainId) {
        const detailId = ids[0];
        contextual = await Variation.findOne(
            {
                equivalentTo: {
                    $size: 2,
                    $all: [
                        new mongoose.Types.ObjectId(mainId),
                        new mongoose.Types.ObjectId(detailId)
                    ]
                }
            },
            { _id: 1, verified: 1, popularity: 1, createdAt: 1 }
        )
            .sort({ verified: -1, popularity: -1, createdAt: 1 })
            .lean();
    }

    const resolved = contextual?._id ? String(contextual._id) : null;
    if (cache) cache.set(signature, resolved);
    return resolved;
}

function resolveGenericDetailIdForVariation({
    variationId,
    normalizedMainExerciseId,
    variationById,
    equivalentToById
}) {
    const id = variationId ? String(variationId) : null;
    if (!id) return null;
    const mainId = normalizedMainExerciseId ? String(normalizedMainExerciseId) : null;
    const doc = variationById?.get(id);
    if (doc?.isExercice !== true && id !== mainId) return id;

    const eqIds = (
        equivalentToById?.get(id)
        || (Array.isArray(doc?.equivalentTo) ? doc.equivalentTo.map((v) => String(v)) : [])
    ).map((v) => String(v));
    const candidate = eqIds.find((eqId) => {
        if (mainId && String(eqId) === mainId) return false;
        const eqDoc = variationById?.get(String(eqId));
        if (!eqDoc) return true;
        return eqDoc?.isExercice !== true;
    });
    return candidate ? String(candidate) : null;
}

function resolveGenericDetailIdFromSourceSet({
    sourceVariationIds,
    normalizedMainExerciseId,
    variationById,
    equivalentToById
}) {
    const ids = (sourceVariationIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length) return null;
    const mainId = normalizedMainExerciseId ? String(normalizedMainExerciseId) : null;

    const directDetail = ids.find((id) => {
        if (mainId && id === mainId) return false;
        const doc = variationById?.get(id);
        return doc?.isExercice !== true;
    });
    if (directDetail) return directDetail;

    for (const id of ids) {
        const detail = resolveGenericDetailIdForVariation({
            variationId: id,
            normalizedMainExerciseId,
            variationById,
            equivalentToById
        });
        if (detail) return detail;
    }
    return null;
}

/**
 * Filtre les sets dont les variations appartiennent à la famille d'une figure (même logique que la timeserie).
 * @param {Array} sets
 * @param {string|null} normalizedMainExerciseId - id Variation ancre (déjà résolu via resolveMainExerciseIdForProgression)
 */
async function filterSetsToMainExerciseFamily(sets, normalizedMainExerciseId) {
    if (!normalizedMainExerciseId || !Array.isArray(sets) || sets.length === 0) {
        return sets;
    }
    const allVariationIds = new global.Set();
    for (const setDoc of sets) {
        const ids = getVariationIdsFromSetDoc(setDoc);
        ids.forEach((id) => allVariationIds.add(String(id)));
    }
    const variationDocs = await Variation.find(
        { _id: { $in: Array.from(allVariationIds).map((id) => new mongoose.Types.ObjectId(id)) } },
        { equivalentTo: 1, isExercice: 1 }
    ).lean();
    const equivalentToById = new Map(
        variationDocs.map((doc) => [String(doc._id), (doc.equivalentTo || []).map((id) => String(id))])
    );
    const isExerciseById = new Map(
        variationDocs.map((doc) => [String(doc._id), doc?.isExercice === true])
    );
    const mainEq = equivalentToById.get(String(normalizedMainExerciseId)) || [];
    const mainRelatedExerciseIds = new global.Set(
        [normalizedMainExerciseId, ...mainEq.filter((id) => isExerciseById.get(String(id)) === true)].map((id) => String(id))
    );

    // Étend la "famille" avec les voisins connectés dans le graphe de progression exo
    // (utile quand la famille n'est pas modélisée via equivalentTo, ex: L-Sit > V-Sit > Manna).
    const queue = [...mainRelatedExerciseIds];
    const visited = new global.Set(queue);
    const maxExpansionRounds = 4;
    for (let round = 0; round < maxExpansionRounds && queue.length > 0; round += 1) {
        const frontier = [...new global.Set(queue.splice(0, queue.length))];
        const frontierObjectIds = frontier
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        if (!frontierObjectIds.length) break;

        const edges = await VariationProgressionEdge.find(
            {
                isActive: true,
                isExerciseVariation: true,
                $or: [
                    { fromVariationId: { $in: frontierObjectIds } },
                    { toVariationId: { $in: frontierObjectIds } },
                    { contextVariationId: { $in: frontierObjectIds } }
                ]
            },
            { fromVariationId: 1, toVariationId: 1, contextVariationId: 1 }
        ).lean();

        for (const edge of edges) {
            const candidates = [
                edge?.fromVariationId ? String(edge.fromVariationId) : null,
                edge?.toVariationId ? String(edge.toVariationId) : null,
                edge?.contextVariationId ? String(edge.contextVariationId) : null
            ].filter(Boolean);
            for (const candidateId of candidates) {
                if (visited.has(candidateId)) continue;
                visited.add(candidateId);
                mainRelatedExerciseIds.add(candidateId);
                queue.push(candidateId);
            }
        }
    }

    return sets.filter((setDoc) => {
        const ids = getVariationIdsFromSetDoc(setDoc);
        if (ids.includes(normalizedMainExerciseId)) return true;
        if (ids.some((id) => (equivalentToById.get(String(id)) || []).includes(normalizedMainExerciseId))) {
            return true;
        }
        return ids.some((id) => mainRelatedExerciseIds.has(String(id)));
    });
}

function resolveDetailVariationIdFromEquivalentTo({
    sourceVariationIds,
    normalizedMainExerciseId,
    equivalentToById,
    variationById,
    mainExerciseIds
}) {
    if (!Array.isArray(sourceVariationIds) || sourceVariationIds.length === 0) return null;

    const sourceIds = sourceVariationIds.map((id) => String(id));
    const mainIds = new global.Set((mainExerciseIds || []).map((id) => String(id)));
    if (normalizedMainExerciseId) mainIds.add(String(normalizedMainExerciseId));

    // 1) Priorité: variation non-exercice et hors "famille main"
    const bestDirectDetail = sourceIds.find((id) => {
        if (mainIds.has(id)) return false;
        const v = variationById?.get(id);
        return v?.isExercice !== true;
    });
    if (bestDirectDetail) return bestDirectDetail;

    // 2) Fallback: n'importe quel id hors "famille main"
    const directDetailFallback = sourceIds.find((id) => !mainIds.has(id));
    if (directDetailFallback) return directDetailFallback;

    // Cas composé: set avec 1 variation (ex: "Tuck Human Flag"), on descend via equivalentTo
    for (const id of sourceIds) {
        const eq = (equivalentToById.get(String(id)) || []).map((x) => String(x));
        if (!eq.length) continue;
        const eqBestDetail = eq.find((x) => {
            if (mainIds.has(x)) return false;
            const v = variationById?.get(String(x));
            return v?.isExercice !== true;
        });
        if (eqBestDetail) return String(eqBestDetail);
        const eqFallback = eq.find((x) => !mainIds.has(x));
        if (eqFallback) return String(eqFallback);
    }

    return null;
}

function parseVariationIdsFromControllerInput(variations) {
    if (!variations) return [];
    const list = Array.isArray(variations) ? variations : [variations];
    const parsed = list.map((v) => {
        if (typeof v === 'string') {
            try {
                const j = JSON.parse(v);
                return j?.variation != null ? String(j.variation) : null;
            } catch {
                if (mongoose.Types.ObjectId.isValid(v)) return String(v);
                return null;
            }
        }
        return v?.variation != null ? String(v.variation) : null;
    }).filter(Boolean);
    return parsed;
}

async function resolveReferenceVariationIdsForProgression({
    referenceVariations,
    mainExerciseId
}) {
    return resolveReferenceVariationIdsForProgressionCore({
        referenceVariations,
        mainExerciseId,
        parseVariationIdsFromControllerInput,
    });
}

function toRoundedOrNull(value, decimals = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = 10 ** decimals;
    return Math.round((n + Number.EPSILON) * factor) / factor;
}

function positiveEstimateOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveFigureNormalizedFallbackLoad({ normalizedExternalLoad }) {
    const load = Number(normalizedExternalLoad);
    return Number.isFinite(load) && load > 0 ? load : null;
}

function resolveNormalizedFigureOneRmEstimates({
    peakOneRmEstimates,
    normalizedExternalLoad,
    repsEquivalent,
    effectiveLoadKgForBrzyckiCheck = null,
}) {
    const storedBrzycki = positiveEstimateOrNull(peakOneRmEstimates?.brzycki);
    const storedEpley = positiveEstimateOrNull(peakOneRmEstimates?.epley);
    const fallbackLoad = resolveFigureNormalizedFallbackLoad({ normalizedExternalLoad });
    const reps = Number(repsEquivalent);
    const normalizedBrzycki = storedBrzycki != null
        ? storedBrzycki
        : (Number.isFinite(fallbackLoad)
            && Number.isFinite(reps)
            && reps > 0
            && shouldUseBrzyckiForRepsEquivalent(reps)
            ? toRoundedOrNull(estimateOneRepMaxBrzycki(fallbackLoad, reps))
            : null);
    const normalizedEpley = storedEpley != null
        ? storedEpley
        : (Number.isFinite(fallbackLoad)
            && Number.isFinite(reps)
            && reps > 0
            ? toRoundedOrNull(estimateOneRepMaxEpley(fallbackLoad, reps))
            : null);
    const normalizedOneRm = resolveAggregateNormalizedOneRm(
        normalizedBrzycki,
        normalizedEpley,
        repsEquivalent,
        effectiveLoadKgForBrzyckiCheck,
    );
    return { normalizedBrzycki, normalizedEpley, normalizedOneRm };
}

function collectExercisePolicyDocs(variationIds, variationById) {
    const docs = [];
    const seen = new global.Set();
    for (const id of variationIds || []) {
        const doc = variationById.get(String(id));
        if (!doc || doc.isExercice !== true) continue;
        const key = String(doc._id);
        if (seen.has(key)) continue;
        seen.add(key);
        docs.push(doc);
    }
    return docs;
}

function resolveSourceBodyweightPolicy(rawSourceVariationIds, expandedSourceVariationIds, variationById) {
    const rawPolicyDocs = collectExercisePolicyDocs(rawSourceVariationIds, variationById);
    const expandedPolicyDocs = collectExercisePolicyDocs(expandedSourceVariationIds, variationById);
    const sourcePolicyDocs = rawPolicyDocs.length > 0 ? rawPolicyDocs : expandedPolicyDocs;
    const includeBodyweight = sourcePolicyDocs.length > 0
        && sourcePolicyDocs.every((doc) => doc?.includeBodyweight === true);
    const exerciseBodyWeightRatio = includeBodyweight
        ? (() => {
            const ratios = sourcePolicyDocs
                .map((doc) => Number(doc?.exerciseBodyWeightRatio))
                .filter((r) => Number.isFinite(r) && r > 0);
            if (!ratios.length) return 1;
            return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
        })()
        : 1;
    if (process.env.STRENGTH_PEAK_DEBUG === '1') {
        console.debug('[Progression][StrengthPeak][BodyweightPolicy]', {
            rawSourceVariationIds: (rawSourceVariationIds || []).map(String),
            expandedSourceVariationIds: (expandedSourceVariationIds || []).map(String),
            policySource: rawPolicyDocs.length > 0 ? 'raw' : 'expanded',
            policyDocIds: sourcePolicyDocs.map((doc) => String(doc._id)),
            includeBodyweight,
            exerciseBodyWeightRatio,
        });
    }
    return { sourcePolicyDocs, includeBodyweight, exerciseBodyWeightRatio };
}

async function augmentSetsWithNormalizedMetrics({
    sets,
    userId,
    referenceVariations,
    mainExerciseId = null,
    adjacencyPrebuilt = null
}) {
    if (!Array.isArray(sets) || sets.length === 0) return [];

    const targetVariationIds = parseVariationIdsFromControllerInput(referenceVariations);
    const targetCanonicalVariationId = await resolveCanonicalVariationIdFromIds(targetVariationIds);
    let normalizedMainExerciseId = mongoose.Types.ObjectId.isValid(mainExerciseId)
        ? String(mainExerciseId)
        : null;
    if (normalizedMainExerciseId) {
        normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    }
    const graphContextVariationId = normalizedMainExerciseId
        ? await resolveGraphContextVariationId(normalizedMainExerciseId)
        : null;

    const allVariationIds = new global.Set();
    for (const setDoc of sets) {
        const ids = getVariationIdsFromSetDoc(setDoc);
        ids.forEach((id) => allVariationIds.add(String(id)));
    }

    const variationDocsForPolicy = allVariationIds.size > 0
        ? await Variation.find(
            { _id: { $in: Array.from(allVariationIds).map((id) => new mongoose.Types.ObjectId(id)) } },
            { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1, name: 1, equivalentTo: 1 }
        ).lean()
        : [];
    const variationByIdForPolicy = new Map(variationDocsForPolicy.map((doc) => [String(doc._id), doc]));
    const equivalentToByIdForPolicy = new Map(
        variationDocsForPolicy.map((doc) => [String(doc._id), (doc.equivalentTo || []).map((id) => String(id))])
    );
    const mainEquivalentIdsForPolicy = normalizedMainExerciseId
        ? (equivalentToByIdForPolicy.get(String(normalizedMainExerciseId)) || []).map((id) => String(id))
        : [];

    const allGroups = [
        targetVariationIds,
        ...sets.map((setDoc) => getVariationIdsFromSetDoc(setDoc))
    ].filter((g) => Array.isArray(g) && g.length > 0);
    const canonicalBySignature = await buildCanonicalVariationMap(allGroups);
    const targetVariationDocForFallback = targetCanonicalVariationId && mongoose.Types.ObjectId.isValid(targetCanonicalVariationId)
        ? await Variation.findById(
            String(targetCanonicalVariationId),
            { _id: 1, isExercice: 1, equivalentTo: 1 }
        ).lean()
        : null;
    if (targetVariationDocForFallback?._id && !variationByIdForPolicy.has(String(targetVariationDocForFallback._id))) {
        variationByIdForPolicy.set(String(targetVariationDocForFallback._id), targetVariationDocForFallback);
        equivalentToByIdForPolicy.set(
            String(targetVariationDocForFallback._id),
            (targetVariationDocForFallback.equivalentTo || []).map((id) => String(id))
        );
    }

    const userMeasures = mongoose.Types.ObjectId.isValid(userId)
        ? await UserMeasure.find(
            { userId: new mongoose.Types.ObjectId(userId) },
            { measuredAt: 1, heightMultiplier: 1, "weight.kg": 1 }
        ).sort({ measuredAt: 1 }).lean()
        : [];
    const targetHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, new Date());

    const augmentedSets = [];
    const contextualSourceCache = new Map();

    for (const setDoc of sets) {
        const set = typeof setDoc.toObject === 'function' ? setDoc.toObject() : { ...setDoc };
        const sourceVariationIds = getVariationIdsFromSetDoc(set);

        const sourceCanonicalVariationId = sourceVariationIds.length > 0
            ? (canonicalBySignature.get(toSortedSignature(sourceVariationIds)) || sourceVariationIds[0])
            : null;
        const sourceDetailVariationId = resolveDetailVariationIdFromEquivalentTo({
            sourceVariationIds,
            normalizedMainExerciseId,
            equivalentToById: equivalentToByIdForPolicy,
            variationById: variationByIdForPolicy,
            mainExerciseIds: mainEquivalentIdsForPolicy
        });
        const sourceContextualVariationId = await resolveContextualSourceVariationId({
            sourceVariationIds,
            normalizedMainExerciseId,
            cache: contextualSourceCache
        });

        const canResolveDifficulty = Boolean(sourceCanonicalVariationId && targetCanonicalVariationId);
        const difficultyOpts = adjacencyPrebuilt != null
            ? { adjacency: adjacencyPrebuilt }
            : {};
        const sourceCandidates = [
            sourceContextualVariationId,
            sourceDetailVariationId,
            sourceCanonicalVariationId
        ].filter(Boolean);
        let difficulty = null;
        let chosenSourceVariationId = null;
        if (targetCanonicalVariationId && sourceCandidates.length > 0) {
            for (const candidateId of sourceCandidates) {
                const d = await getDifficultyRatio({
                    fromVariationId: candidateId,
                    toVariationId: targetCanonicalVariationId,
                    contextVariationId: graphContextVariationId || undefined,
                    ...difficultyOpts
                });
                if (Number.isFinite(Number(d?.ratio)) && Number(d.ratio) > 0) {
                    difficulty = d;
                    chosenSourceVariationId = String(candidateId);
                    break;
                }
            }
        }
        if (!Number.isFinite(Number(difficulty?.ratio)) || Number(difficulty?.ratio) <= 0) {
            const sourceGenericDetailId = resolveGenericDetailIdFromSourceSet({
                sourceVariationIds,
                normalizedMainExerciseId,
                variationById: variationByIdForPolicy,
                equivalentToById: equivalentToByIdForPolicy
            });
            const targetGenericDetailId = resolveGenericDetailIdForVariation({
                variationId: targetCanonicalVariationId,
                normalizedMainExerciseId,
                variationById: variationByIdForPolicy,
                equivalentToById: equivalentToByIdForPolicy
            });
            if (sourceGenericDetailId && targetGenericDetailId) {
                const fallbackWithContext = await getDifficultyRatio({
                    fromVariationId: sourceGenericDetailId,
                    toVariationId: targetGenericDetailId,
                    contextVariationId: graphContextVariationId || undefined,
                    ...difficultyOpts
                });
                let fallbackDifficulty = fallbackWithContext;
                if (!Number.isFinite(Number(fallbackWithContext?.ratio)) || Number(fallbackWithContext.ratio) <= 0) {
                    fallbackDifficulty = await getDifficultyRatio({
                        fromVariationId: sourceGenericDetailId,
                        toVariationId: targetGenericDetailId,
                        contextVariationId: undefined
                    });
                }
                if (Number.isFinite(Number(fallbackDifficulty?.ratio)) && Number(fallbackDifficulty.ratio) > 0) {
                    difficulty = fallbackDifficulty;
                    chosenSourceVariationId = String(sourceGenericDetailId);
                }
            }
        }
        const ratio = Number.isFinite(Number(difficulty?.ratio)) && Number(difficulty.ratio) > 0
            ? Number(difficulty.ratio)
            : 1;

        const sourceHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, set?.date);
        const morphologyFactor = targetHeightMultiplier / sourceHeightMultiplier;
        const difficultyFactor = (1 / ratio) * morphologyFactor;

        const {
            includeBodyweight,
            exerciseBodyWeightRatio,
        } = resolveSourceBodyweightPolicy(
            sourceVariationIds,
            resolveChartSourceVariationIds(sourceVariationIds, variationByIdForPolicy),
            variationByIdForPolicy,
        );
        const userWeightKg = resolveUserWeightKgForDate(userMeasures, set?.date);
        const weightedBodyweightKg = includeBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * Number(exerciseBodyWeightRatio)
            : 0;
        const externalEffectiveLoad = getEffectiveLoadKg(set, {
            includeBodyweight: false,
        });
        const normalizedExternalLoad = Number.isFinite(externalEffectiveLoad)
            ? Math.round((externalEffectiveLoad * difficultyFactor + Number.EPSILON) * 1000) / 1000
            : null;
        const repsEquivalent = set.unit === 'cardio'
            ? null
            : set.unit === 'seconds'
                ? secondsToEquivalentReps(set.value)
                : set.value;
        const peakOneRmEstimates = mapSetWithPeakOneRmEstimates({
            ...set,
            repsEquivalent: Number.isFinite(Number(repsEquivalent)) ? Number(repsEquivalent) : null,
            _weightedBodyweightKg: weightedBodyweightKg,
            oneRepMaxUserWeightKg: userWeightKg,
            oneRepMaxExerciseBodyWeightRatio: exerciseBodyWeightRatio,
        }, {
            useStoredEstimatesOnly: true,
            difficultyFactor,
        });
        const effectiveLoadKgForBrzyckiCheck = includeBodyweight && weightedBodyweightKg > 0
            ? (Number.isFinite(externalEffectiveLoad) ? Number(externalEffectiveLoad) : 0) + weightedBodyweightKg
            : (Number.isFinite(normalizedExternalLoad) && normalizedExternalLoad > 0
                ? normalizedExternalLoad
                : null);
        const {
            normalizedBrzycki,
            normalizedEpley,
            normalizedOneRm,
        } = resolveNormalizedFigureOneRmEstimates({
            peakOneRmEstimates,
            normalizedExternalLoad,
            repsEquivalent,
            effectiveLoadKgForBrzyckiCheck,
        });
        let normalizedOneRmForRecommendation = resolveNormalizedOneRmForRecommendation({
            normalizedOneRm,
            brzyckiWithBodyweight: set.brzyckiWithBodyweight ?? set.brzycki_with_bodyweight,
            epleyWithBodyweight: set.epleyWithBodyweight ?? set.epley_with_bodyweight,
            normalizedBrzycki,
            normalizedEpley,
            weightedBodyweightKg,
            repsEquivalent,
            difficultyFactor,
            includeBodyweight,
            externalEffectiveLoadKg: Number.isFinite(externalEffectiveLoad) ? externalEffectiveLoad : 0,
            effectiveLoadKgForBrzyckiCheck,
        });

        augmentedSets.push({
            ...set,
            rawEffectiveWeightLoad: Number.isFinite(externalEffectiveLoad) ? externalEffectiveLoad : null,
            repsEquivalent: Number.isFinite(Number(repsEquivalent)) ? Number(repsEquivalent) : null,
            brzycki: normalizedBrzycki,
            epley: normalizedEpley,
            normalizedEffectiveWeightLoad: normalizedExternalLoad,
            normalizedBrzycki,
            normalizedEpley,
            normalizedOneRm,
            normalizedOneRmForRecommendation,
            sourceVariationId: chosenSourceVariationId || sourceContextualVariationId || sourceDetailVariationId || sourceCanonicalVariationId || null,
            targetVariationId: targetCanonicalVariationId || null,
            difficultyRatioUsed: ratio,
            difficultyFactor,
            heightMultiplierUsed: {
                source: sourceHeightMultiplier,
                target: targetHeightMultiplier
            }
        });
    }

    return augmentedSets;
}

async function getCardioProgressionTimeseries({
    userId,
    referenceVariations,
    mainExerciseId = null,
    dateMin,
    dateMax,
    valueMin,
    valueMax,
    unilateralSide = undefined,
    isUnilateral = undefined,
    lateralMode = 'bilateral',
    includedVariationIds = null,
    excludedVariationSignatures = null,
    weightUnit = 'kg',
}) {
    const normalizedLateralMode = normalizeLateralMode(lateralMode);
    const parsedExcludedVariationSignatures = parseExcludedVariationSignatures(excludedVariationSignatures);
    const excludedVariationSignaturesSet = parsedExcludedVariationSignatures === null
        ? null
        : new global.Set(parsedExcludedVariationSignatures.map((s) => String(s)));
    const targetVariationIds = await resolveReferenceVariationIdsForProgression({
        referenceVariations,
        mainExerciseId,
    });
    const targetCanonicalVariationIdRaw = await resolveCanonicalVariationIdFromIds(targetVariationIds);

    let normalizedMainExerciseId = mongoose.Types.ObjectId.isValid(mainExerciseId)
        ? String(mainExerciseId)
        : null;
    if (normalizedMainExerciseId) {
        normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    }
    const familyScope = await resolveFamilyScopeSignaturesForTimeseries({
        userId,
        referenceVariationIds: targetVariationIds,
    });
    const familyScopeSignatures = familyScope?.signatures || null;

    const sets = await getSets(
        userId,
        null,
        null,
        null,
        null,
        'cardio',
        null,
        null,
        null,
        dateMin,
        dateMax,
        null,
        null,
        unilateralSide,
        isUnilateral,
    );

    let filteredSets = normalizedMainExerciseId
        ? await filterSetsToMainExerciseFamily(sets, normalizedMainExerciseId)
        : sets;

    const lateralAvailability = computeLateralAvailability(filteredSets);
    filteredSets = filterSetsByLateralMode(filteredSets, normalizedLateralMode);

    const parsedValueMin = Number(valueMin);
    const parsedValueMax = Number(valueMax);
    if (Number.isFinite(parsedValueMin) || Number.isFinite(parsedValueMax)) {
        filteredSets = filteredSets.filter((setDoc) => {
            const setValue = Number(setDoc?.value);
            if (!Number.isFinite(setValue)) return false;
            if (Number.isFinite(parsedValueMin) && !(setValue > parsedValueMin)) return false;
            if (Number.isFinite(parsedValueMax) && !(setValue < parsedValueMax)) return false;
            return true;
        });
    }

    const allVariationIds = new global.Set();
    for (const setDoc of filteredSets) {
        const ids = getVariationIdsFromSetDoc(setDoc);
        ids.forEach((id) => allVariationIds.add(String(id)));
    }
    if (normalizedMainExerciseId) {
        allVariationIds.add(String(normalizedMainExerciseId));
    }
    if (includedVariationIds != null) {
        const parsedIncludedForLoad = parseIncludedVariationIds(includedVariationIds) || [];
        parsedIncludedForLoad.forEach((id) => allVariationIds.add(String(id)));
    }
    const variationDocsForPolicy = await Variation.find(
        { _id: { $in: Array.from(allVariationIds).map((id) => new mongoose.Types.ObjectId(id)) } },
        { isExercice: 1, name: 1, equivalentTo: 1 },
    ).lean();
    const variationByIdForPolicy = new Map(variationDocsForPolicy.map((doc) => [String(doc._id), doc]));

    if (includedVariationIds != null) {
        const parsedIncluded = parseIncludedVariationIds(includedVariationIds) || [];
        const allowedIncluded = new global.Set(parsedIncluded.map((id) => String(id)));
        filteredSets = (filteredSets || []).filter((setDoc) => {
            const rawIds = getVariationIdsFromSetDoc(setDoc);
            const expandedIds = resolveChartSourceVariationIds(rawIds, variationByIdForPolicy);
            return [...rawIds, ...expandedIds].some((id) => allowedIncluded.has(String(id)));
        });
    }
    if (familyScopeSignatures && familyScopeSignatures.size > 0) {
        filteredSets = (filteredSets || []).filter((setDoc) => {
            const signature = resolveSetProgressionSignature(setDoc, variationByIdForPolicy);
            return signature ? familyScopeSignatures.has(signature) : false;
        });
    }

    const points = [];
    for (const setDoc of filteredSets) {
        const set = typeof setDoc.toObject === 'function' ? setDoc.toObject() : setDoc;
        const rawSourceVariationIds = getVariationIdsFromSetDoc(set);
        if (!rawSourceVariationIds.length) continue;
        const sourceVariationIds = resolveChartSourceVariationIds(
            rawSourceVariationIds,
            variationByIdForPolicy,
        );
        const sourceVariationSignature = toSortedSignature(sourceVariationIds);
        if (excludedVariationSignaturesSet && excludedVariationSignaturesSet.has(sourceVariationSignature)) {
            continue;
        }
        const point = mapSetToCardioPoint(set, sourceVariationSignature);
        if (!point) continue;
        point.sourceVariationLabel = buildLocalizedLabelFromVariationIds(
            sourceVariationIds,
            variationByIdForPolicy,
        );
        point.sourceVariationIds = sourceVariationIds;
        point.mergedVariationsNames = set?.mergedVariationsNames || null;
        points.push(point);
    }

    points.sort((a, b) => new Date(a.date) - new Date(b.date));

    const referenceSourceVariationSignature = targetVariationIds.length
        ? toSortedSignature(targetVariationIds)
        : null;
    const referenceSignaturePoints = referenceSourceVariationSignature
        ? points.filter((p) => String(p?.sourceVariationSignature || '') === String(referenceSourceVariationSignature))
        : points;
    const cardioPeakBasePoints = referenceSignaturePoints.length > 0 ? referenceSignaturePoints : points;
    const cardioPeak = {
        ...computeCardioPeakFromPoints(cardioPeakBasePoints, { weightUnit }),
        sourceScope: referenceSignaturePoints.length > 0 ? 'reference-signature' : 'visible-variations-fallback',
        sourceVariationSignature: referenceSourceVariationSignature,
        sourceScopeDescription: [
            'Record distance calculé sur la sélection active du graphe.',
            'Distance record computed from the active chart selection.',
        ],
    };
    const { peaksBySignature: cardioPeaksBySignature, setCountsBySignature } = buildCardioPeaksBySignature(
        points,
        { weightUnit },
    );

    const mainVariationDoc = normalizedMainExerciseId
        ? variationByIdForPolicy.get(String(normalizedMainExerciseId))
        : null;
    const mainVariationName = mainVariationDoc?.name || null;

    return {
        points,
        meta: {
            mode: 'cardio',
            targetVariationId: targetCanonicalVariationIdRaw,
            familyAnchorId: normalizedMainExerciseId,
            mainExerciseId: normalizedMainExerciseId,
            mainVariationName,
            graphEnabled: true,
            count: points.length,
            setsCount: points.length,
            lateralMode: normalizedLateralMode,
            hasBilateralSets: lateralAvailability.hasBilateralSets,
            hasLeftSets: lateralAvailability.hasLeftSets,
            hasRightSets: lateralAvailability.hasRightSets,
            familyScopeDebug: familyScope?.debug || null,
            cardioPeak,
            strengthPeak: cardioPeak,
            cardioPeaksBySignature,
            strengthPeaksBySignature: cardioPeaksBySignature,
            setCountsBySignature,
            referenceVariationSignature: referenceSourceVariationSignature,
        },
    };
}

async function getNormalizedProgressionTimeseries({
    userId,
    referenceVariations,
    mainExerciseId = null,
    dateMin,
    dateMax,
    valueMin,
    valueMax,
    unit = null,
    unilateralSide = undefined,
    isUnilateral = undefined,
    lateralMode = 'bilateral',
    includedVariationIds = null,
    excludedVariationSignatures = null,
    weightUnit = 'kg',
}) {
    if (unit === 'cardio') {
        return getCardioProgressionTimeseries({
            userId,
            referenceVariations,
            mainExerciseId,
            dateMin,
            dateMax,
            valueMin,
            valueMax,
            unilateralSide,
            isUnilateral,
            lateralMode,
            includedVariationIds,
            excludedVariationSignatures,
            weightUnit,
        });
    }
    const normalizedLateralMode = normalizeLateralMode(lateralMode);
    const parsedExcludedVariationSignatures = parseExcludedVariationSignatures(excludedVariationSignatures);
    const excludedVariationSignaturesSet = parsedExcludedVariationSignatures === null
        ? null
        : new global.Set(parsedExcludedVariationSignatures.map((s) => String(s)));
    const targetVariationIds = await resolveReferenceVariationIdsForProgression({
        referenceVariations,
        mainExerciseId
    });
    const targetCanonicalVariationIdRaw = await resolveCanonicalVariationIdFromIds(targetVariationIds);

    let normalizedMainExerciseId = mongoose.Types.ObjectId.isValid(mainExerciseId)
        ? String(mainExerciseId)
        : null;
    if (normalizedMainExerciseId) {
        normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    }
    const progressionGraphContextVariationId = normalizedMainExerciseId
        ? await resolveGraphContextVariationId(normalizedMainExerciseId)
        : null;
    const targetCanonicalVariationId = await resolveContextualReferenceVariationId(
        targetCanonicalVariationIdRaw,
        normalizedMainExerciseId
    );
    const familyScope = await resolveFamilyScopeSignaturesForTimeseries({
        userId,
        referenceVariationIds: targetVariationIds,
    });
    const familyScopeSignatures = familyScope?.signatures || null;

    const sets = await getSets(
        userId,
        null,
        null,
        null,
        null,
        unit,
        null,
        null,
        null,
        dateMin,
        dateMax,
        null,
        null,
        unilateralSide,
        isUnilateral
    );

    let filteredSets = normalizedMainExerciseId
        ? await filterSetsToMainExerciseFamily(sets, normalizedMainExerciseId)
        : sets;

    const lateralAvailability = computeLateralAvailability(filteredSets);
    filteredSets = filterSetsByLateralMode(filteredSets, normalizedLateralMode);

    const parsedValueMin = Number(valueMin);
    const parsedValueMax = Number(valueMax);
    if (Number.isFinite(parsedValueMin) || Number.isFinite(parsedValueMax)) {
        filteredSets = filteredSets.filter((setDoc) => {
            const setValue = Number(setDoc?.value);
            if (!Number.isFinite(setValue)) return false;
            if (Number.isFinite(parsedValueMin) && !(setValue > parsedValueMin)) return false;
            if (Number.isFinite(parsedValueMax) && !(setValue < parsedValueMax)) return false;
            return true;
        });
    }

    const userMeasures = await UserMeasure.find(
        { userId: new mongoose.Types.ObjectId(userId) },
        { measuredAt: 1, heightMultiplier: 1, "weight.kg": 1 }
    ).sort({ measuredAt: 1 }).lean();
    const targetHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, new Date());

    const allVariationIds = new global.Set();
    for (const setDoc of filteredSets) {
        const ids = getVariationIdsFromSetDoc(setDoc);
        ids.forEach((id) => allVariationIds.add(String(id)));
    }
    if (targetCanonicalVariationId) {
        allVariationIds.add(String(targetCanonicalVariationId));
    }
    if (normalizedMainExerciseId) {
        allVariationIds.add(String(normalizedMainExerciseId));
        const graphNodeIds = await collectGraphVariationNodeIdsForContext(progressionGraphContextVariationId);
        for (const nodeId of graphNodeIds) {
            allVariationIds.add(String(nodeId));
        }
    }
    if (includedVariationIds != null) {
        const parsedIncludedForLoad = parseIncludedVariationIds(includedVariationIds) || [];
        parsedIncludedForLoad.forEach((id) => allVariationIds.add(String(id)));
    }
    const variationDocsForPolicy = await Variation.find(
        { _id: { $in: Array.from(allVariationIds).map((id) => new mongoose.Types.ObjectId(id)) } },
        { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1, name: 1, equivalentTo: 1 }
    ).lean();
    const variationByIdForPolicy = new Map(variationDocsForPolicy.map((doc) => [String(doc._id), doc]));
    const equivalentToByIdForPolicy = new Map(
        variationDocsForPolicy.map((doc) => [String(doc._id), (doc.equivalentTo || []).map((id) => String(id))])
    );
    const mainEquivalentIdsForPolicy = normalizedMainExerciseId
        ? (equivalentToByIdForPolicy.get(String(normalizedMainExerciseId)) || []).map((id) => String(id))
        : [];

    if (includedVariationIds != null) {
        const parsedIncluded = parseIncludedVariationIds(includedVariationIds) || [];
        // NOTE: `Set` est masqué en haut de fichier (Mongoose model). On force `global.Set`.
        const allowedIncluded = new global.Set(parsedIncluded.map((id) => String(id)));
        filteredSets = (filteredSets || []).filter((setDoc) => {
            const rawIds = getVariationIdsFromSetDoc(setDoc);
            const expandedIds = resolveChartSourceVariationIds(rawIds, variationByIdForPolicy);
            return [...rawIds, ...expandedIds].some((id) => allowedIncluded.has(String(id)));
        });
    }
    if (familyScopeSignatures && familyScopeSignatures.size > 0) {
        filteredSets = (filteredSets || []).filter((setDoc) => {
            const signature = resolveSetProgressionSignature(setDoc, variationByIdForPolicy);
            return signature ? familyScopeSignatures.has(signature) : false;
        });
    }
    console.debug('[Progression][TimeseriesScope]', {
        userId: String(userId || ''),
        mainExerciseId: normalizedMainExerciseId,
        referenceVariationIds: targetVariationIds,
        familyScope: familyScope?.debug || null,
        filteredSetsCount: Array.isArray(filteredSets) ? filteredSets.length : 0,
    });

    const allGroups = [
        targetVariationIds,
        ...filteredSets.map((setDoc) => getVariationIdsFromSetDoc(setDoc))
    ].filter((g) => Array.isArray(g) && g.length > 0);
    const canonicalBySignature = await buildCanonicalVariationMap(allGroups);

    const adjacencyPrebuiltTimeseries = normalizedMainExerciseId
        ? await buildAdjacencyList({ contextVariationId: progressionGraphContextVariationId })
        : null;
    const difficultyOptsTs = adjacencyPrebuiltTimeseries != null
        ? { adjacency: adjacencyPrebuiltTimeseries }
        : {};

    const points = [];
    for (const setDoc of filteredSets) {
        const set = typeof setDoc.toObject === 'function' ? setDoc.toObject() : setDoc;
        const rawSourceVariationIds = getVariationIdsFromSetDoc(set);
        if (!rawSourceVariationIds.length) continue;
        const sourceVariationIds = resolveChartSourceVariationIds(
            rawSourceVariationIds,
            variationByIdForPolicy,
        );
        const sourceVariationSignature = toSortedSignature(sourceVariationIds);
        if (excludedVariationSignaturesSet && excludedVariationSignaturesSet.has(sourceVariationSignature)) {
            continue;
        }
        const sourceCanonicalVariationId = canonicalBySignature.get(sourceVariationSignature) || sourceVariationIds[0];
        const sourceDetailVariationId = resolveDetailVariationIdFromEquivalentTo({
            sourceVariationIds,
            normalizedMainExerciseId,
            equivalentToById: equivalentToByIdForPolicy,
            variationById: variationByIdForPolicy,
            mainExerciseIds: mainEquivalentIdsForPolicy
        });
        const difficultyFromCanonical = await getDifficultyRatio({
            fromVariationId: sourceCanonicalVariationId,
            toVariationId: targetCanonicalVariationId,
            contextVariationId: progressionGraphContextVariationId || undefined,
            ...difficultyOptsTs
        });
        const difficultyFromDetail = sourceDetailVariationId
            ? await getDifficultyRatio({
                fromVariationId: sourceDetailVariationId,
                toVariationId: targetCanonicalVariationId,
                contextVariationId: progressionGraphContextVariationId || undefined,
                ...difficultyOptsTs
            })
            : null;
        const difficulty = Number.isFinite(Number(difficultyFromDetail?.ratio)) && Number(difficultyFromDetail.ratio) > 0
            ? difficultyFromDetail
            : difficultyFromCanonical;
        let chosenDifficulty = difficulty;
        let chosenSourceVariationIdForDifficulty = sourceDetailVariationId || sourceCanonicalVariationId;
        if (!Number.isFinite(Number(chosenDifficulty?.ratio)) || Number(chosenDifficulty?.ratio) <= 0) {
            const sourceGenericDetailId = resolveGenericDetailIdFromSourceSet({
                sourceVariationIds,
                normalizedMainExerciseId,
                variationById: variationByIdForPolicy,
                equivalentToById: equivalentToByIdForPolicy
            });
            const targetGenericDetailId = resolveGenericDetailIdForVariation({
                variationId: targetCanonicalVariationId,
                normalizedMainExerciseId,
                variationById: variationByIdForPolicy,
                equivalentToById: equivalentToByIdForPolicy
            });
            if (sourceGenericDetailId && targetGenericDetailId) {
                const fallbackWithContext = await getDifficultyRatio({
                    fromVariationId: sourceGenericDetailId,
                    toVariationId: targetGenericDetailId,
                    contextVariationId: progressionGraphContextVariationId || undefined,
                    ...difficultyOptsTs
                });
                let fallbackDifficulty = fallbackWithContext;
                if (!Number.isFinite(Number(fallbackWithContext?.ratio)) || Number(fallbackWithContext.ratio) <= 0) {
                    fallbackDifficulty = await getDifficultyRatio({
                        fromVariationId: sourceGenericDetailId,
                        toVariationId: targetGenericDetailId,
                        contextVariationId: undefined
                    });
                }
                if (Number.isFinite(Number(fallbackDifficulty?.ratio)) && Number(fallbackDifficulty.ratio) > 0) {
                    chosenDifficulty = fallbackDifficulty;
                    chosenSourceVariationIdForDifficulty = sourceGenericDetailId;
                }
            }
        }
        const ratio = Number.isFinite(Number(chosenDifficulty?.ratio)) && Number(chosenDifficulty.ratio) > 0
            ? Number(chosenDifficulty.ratio)
            : 1;
        const conversionRatioToReference = ratio > 0 ? (1 / ratio) : 1;
        const sourceHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, set?.date);
        const morphologyFactor = targetHeightMultiplier / sourceHeightMultiplier;
        const difficultyFactor = conversionRatioToReference * morphologyFactor;

        const {
            includeBodyweight,
            exerciseBodyWeightRatio,
        } = resolveSourceBodyweightPolicy(rawSourceVariationIds, sourceVariationIds, variationByIdForPolicy);
        const userWeightKg = resolveUserWeightKgForDate(userMeasures, set?.date);
        const weightedBodyweightKg = includeBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * Number(exerciseBodyWeightRatio)
            : 0;
        const externalEffectiveLoad = getEffectiveLoadKg(set, {
            includeBodyweight: false,
        });
        const normalizedExternalLoad = Number.isFinite(externalEffectiveLoad)
            ? Math.round((externalEffectiveLoad * difficultyFactor + Number.EPSILON) * 1000) / 1000
            : null;
        const repsEquivalent = set.unit === 'cardio'
            ? null
            : set.unit === 'seconds'
                ? secondsToEquivalentReps(set.value)
                : set.value;
        const peakOneRmEstimates = mapSetWithPeakOneRmEstimates({
            ...set,
            repsEquivalent: Number.isFinite(Number(repsEquivalent)) ? Number(repsEquivalent) : null,
            _weightedBodyweightKg: weightedBodyweightKg,
            oneRepMaxUserWeightKg: userWeightKg,
            oneRepMaxExerciseBodyWeightRatio: exerciseBodyWeightRatio,
        }, {
            useStoredEstimatesOnly: true,
            difficultyFactor,
        });
        const {
            normalizedBrzycki,
            normalizedEpley,
            normalizedOneRm,
        } = resolveNormalizedFigureOneRmEstimates({
            peakOneRmEstimates,
            normalizedExternalLoad,
            repsEquivalent,
        });

        const sourceVariationLabel = buildLocalizedLabelFromVariationIds(
            sourceVariationIds,
            variationByIdForPolicy,
        );
        const sourceVariationNames = sourceVariationIds.map((id) => {
            const doc = variationByIdForPolicy.get(String(id));
            return {
                id: String(id),
                fr: doc?.name?.fr || doc?.name?.en || String(id),
                en: doc?.name?.en || doc?.name?.fr || String(id),
            };
        });

        points.push({
            setId: set._id,
            seanceId: set?.seance != null ? String(set.seance) : null,
            date: set.date,
            unit: set.unit,
            sourceSetVariationIds: rawSourceVariationIds,
            sourceVariationIds,
            sourceVariationSignature: sourceVariationSignature,
            sourceVariationLabel,
            sourceVariationNames,
            sourceCanonicalVariationId: sourceCanonicalVariationId,
            mergedVariationsNames: set?.mergedVariationsNames || null,
            rawValue: set.value,
            rawWeightLoad: set.weightLoad,
            rawElastic: set.elastic,
            rawEffectiveWeightLoad: Number.isFinite(externalEffectiveLoad) ? externalEffectiveLoad : null,
            repsEquivalent: Number.isFinite(Number(repsEquivalent)) ? Number(repsEquivalent) : null,
            brzycki: normalizedBrzycki,
            epley: normalizedEpley,
            oneRepMaxIncludesBodyweight: includeBodyweight,
            oneRepMaxUserWeightKg: userWeightKg,
            oneRepMaxExerciseBodyWeightRatio: exerciseBodyWeightRatio,
            difficultyFactor,
            normalizedEffectiveWeightLoad: normalizedExternalLoad,
            normalizedBrzycki,
            normalizedEpley,
            normalizedOneRm,
            sourceVariationId: chosenSourceVariationIdForDifficulty,
            targetVariationId: targetCanonicalVariationId,
            // Coefficient réellement appliqué pour convertir vers la référence.
            // Si la source est plus facile que la cible de référence, ce coefficient est < 1.
            difficultyRatioUsed: conversionRatioToReference,
            // Ratio "graphe" brut source -> cible (conservé pour debug/traçabilité).
            difficultySourceToTargetRatio: ratio,
            heightMultiplierUsed: {
                source: sourceHeightMultiplier,
                target: targetHeightMultiplier
            },
            path: Array.isArray(chosenDifficulty?.path) ? chosenDifficulty.path : [],
            pathNames: (Array.isArray(chosenDifficulty?.path) ? chosenDifficulty.path : []).map((id) => {
                const doc = variationByIdForPolicy.get(String(id));
                if (!doc?.name) return String(id);
                return {
                    id: String(id),
                    fr: doc.name.fr || null,
                    en: doc.name.en || null
                };
            }),
            hops: Number.isFinite(Number(chosenDifficulty?.hops)) ? Number(chosenDifficulty.hops) : null
        });
    }

    let peak = null;
    for (const p of points) {
        const ref = Number.isFinite(Number(p?.brzycki)) && Number(p.brzycki) > 0
            ? Number(p.brzycki)
            : Number(p?.normalizedOneRm);
        if (!Number.isFinite(ref) || ref <= 0) continue;
        if (!peak || ref > Number(peak.normalizedOneRm)) {
            peak = {
                setId: p.setId,
                date: p.date,
                normalizedOneRm: ref,
                normalizedOneRmLbs: toRoundedOrNull(ref * KG_TO_LB, 2),
                normalizedBrzycki: p.normalizedBrzycki,
                normalizedEpley: p.normalizedEpley,
                normalizedEffectiveWeightLoad: p.normalizedEffectiveWeightLoad,
                sourceVariationId: p.sourceVariationId,
                targetVariationId: p.targetVariationId
            };
        }
    }

    const resolveVariationNameMeta = async (variationId) => {
        if (!variationId) return null;
        const key = String(variationId);
        const fromMap = variationByIdForPolicy.get(key);
        if (fromMap?.name) {
            const n = fromMap.name;
            if (!n.fr && !n.en) return null;
            return { fr: n.fr || null, en: n.en || null };
        }
        const doc = await Variation.findById(key, { name: 1 }).lean();
        if (!doc?.name) return null;
        const n = doc.name;
        if (!n.fr && !n.en) return null;
        return { fr: n.fr || null, en: n.en || null };
    };

    const mainVariationIdForMeta = normalizedMainExerciseId || targetCanonicalVariationId;
    const mainVariationName = await resolveVariationNameMeta(mainVariationIdForMeta);

    const peakPoint = peak?.setId
        ? points.find((p) => String(p.setId) === String(peak.setId))
        : null;
    const mergedVariationsNamesMeta = peakPoint?.mergedVariationsNames
        ?? (points[0]?.mergedVariationsNames ?? null);

    const rawReferenceSignature = targetVariationIds.length > 0
        ? toSortedSignature(targetVariationIds)
        : null;
    const referenceSourceVariationIds = resolveChartSourceVariationIds(targetVariationIds, variationByIdForPolicy);
    const referenceSourceVariationSignature = referenceSourceVariationIds.length > 0
        ? toSortedSignature(referenceSourceVariationIds)
        : null;
    const referenceSignaturePoints = referenceSourceVariationSignature
        ? points.filter((p) => String(p?.sourceVariationSignature || '') === String(referenceSourceVariationSignature))
        : [];
    const rawReferenceSignaturePoints = rawReferenceSignature
        ? points.filter((p) => {
            const rawIds = Array.isArray(p?.sourceSetVariationIds) ? p.sourceSetVariationIds.map((id) => String(id)) : [];
            return rawIds.length > 0 && toSortedSignature(rawIds) === rawReferenceSignature;
        })
        : [];
    const referenceIdSet = new global.Set((targetVariationIds || []).map((id) => String(id)));
    const referenceContainsPoints = referenceIdSet.size >= 2
        ? points.filter((p) => {
            const rawIds = new global.Set(
                Array.isArray(p?.sourceSetVariationIds)
                    ? p.sourceSetVariationIds.map((id) => String(id))
                    : []
            );
            if (rawIds.size === 0) return false;
            for (const referenceId of referenceIdSet) {
                if (!rawIds.has(referenceId)) return false;
            }
            return true;
        })
        : [];

    let strengthPeakBasePoints = referenceSignaturePoints;
    let strengthPeakScope = 'reference-signature';
    if (strengthPeakBasePoints.length === 0 && rawReferenceSignaturePoints.length > 0) {
        strengthPeakBasePoints = rawReferenceSignaturePoints;
        strengthPeakScope = 'reference-raw-signature';
    }
    if (strengthPeakBasePoints.length === 0 && referenceContainsPoints.length > 0) {
        strengthPeakBasePoints = referenceContainsPoints;
        strengthPeakScope = 'reference-contains-all-ids';
    }
    if (strengthPeakBasePoints.length === 0) {
        strengthPeakBasePoints = points;
        strengthPeakScope = 'visible-variations-fallback';
    }

    const strengthPeakScopeDebug = {
        referenceIds: targetVariationIds,
        rawReferenceSignature,
        expandedReferenceSignature: referenceSourceVariationSignature,
        pointsCount: points.length,
        basePointsCount: strengthPeakBasePoints.length,
        strengthPeakScope,
        expandedSignatureMatches: referenceSignaturePoints.length,
        rawSignatureMatches: rawReferenceSignaturePoints.length,
        containsAllIdsMatches: referenceContainsPoints.length,
        samplePointSignatures: [...new global.Set(points.map((p) => String(p?.sourceVariationSignature || '')))].slice(0, 8),
        basePointSample: strengthPeakBasePoints.slice(0, 6).map((p) => ({
            setId: p?.setId != null ? String(p.setId) : null,
            date: p?.date ?? null,
            rawValue: p?.rawValue ?? null,
            rawWeightLoad: p?.rawWeightLoad ?? null,
            brzycki: p?.brzycki ?? null,
            epley: p?.epley ?? null,
            normalizedOneRm: p?.normalizedOneRm ?? null,
            sourceVariationSignature: p?.sourceVariationSignature ?? null,
            sourceSetVariationIds: Array.isArray(p?.sourceSetVariationIds)
                ? p.sourceSetVariationIds.map((id) => String(id))
                : [],
        })),
    };

    if (strengthPeakScope === 'visible-variations-fallback') {
        console.warn('[Progression][StrengthPeak] fallback to visible variations', strengthPeakScopeDebug);
    } else {
        console.debug('[Progression][StrengthPeak] scoped base points', strengthPeakScopeDebug);
    }

    const strengthPeakScopeDescription = [
        "Pic et progression calculés sur la sélection active du graphe.",
        "Peak and progression are computed from the active chart selection.",
    ];
    const { peaksBySignature: strengthPeaksBySignature, setCountsBySignature } = buildStrengthPeaksBySignature(
        points,
        {
            weightUnit,
            debugContext: {
                mainExerciseId: normalizedMainExerciseId,
                referenceVariationIds: targetVariationIds,
                lateralMode: normalizedLateralMode,
            },
        },
    );
    for (const signature of Object.keys(strengthPeaksBySignature)) {
        const sigPoints = points.filter((p) => String(p?.sourceVariationSignature || '') === String(signature));
        const sigIds = String(signature).split('|').filter(Boolean);
        strengthPeaksBySignature[signature] = {
            ...strengthPeaksBySignature[signature],
            sourceVariationLabel: buildReferenceVariationLabelForStrengthPeak(
                sigIds,
                variationByIdForPolicy,
                sigPoints,
            ),
        };
    }
    const sourceVariationLabel = buildReferenceVariationLabelForStrengthPeak(
        targetVariationIds,
        variationByIdForPolicy,
        strengthPeakBasePoints,
    );
    const strengthPeak = {
        ...computeStrengthPeakFromFigurePoints(strengthPeakBasePoints, {
            weightUnit,
            debugContext: {
                mainExerciseId: normalizedMainExerciseId,
                referenceVariationIds: targetVariationIds,
                lateralMode: normalizedLateralMode,
                strengthPeakScope,
            },
        }),
        sourceScope: strengthPeakScope,
        sourceVariationSignature: referenceSourceVariationSignature,
        sourceVariationLabel,
        sourceScopeDescription: strengthPeakScopeDescription,
    };

    console.debug('[Progression][StrengthPeak] result', {
        mainExerciseId: normalizedMainExerciseId,
        referenceVariationIds: targetVariationIds,
        lateralMode: normalizedLateralMode,
        strengthPeakScope,
        percentageFromStart: strengthPeak?.percentageFromStart ?? null,
        referenceKg: strengthPeak?.referenceKg ?? null,
        firstReferenceKg: strengthPeak?.firstSetPeak?.referenceKg ?? null,
        peakRawValue: strengthPeak?.source?.value ?? null,
        firstRawValue: strengthPeak?.firstSetPeak?.source?.value ?? null,
        hasEstimate: strengthPeak?.hasEstimate === true,
    });

    return {
        points,
        meta: {
            targetVariationId: targetCanonicalVariationId,
            familyAnchorId: normalizedMainExerciseId,
            mainExerciseId: normalizedMainExerciseId,
            mainVariationName,
            mergedVariationsNames: mergedVariationsNamesMeta,
            mandatoryMorphology: true,
            graphEnabled: true,
            count: points.length,
            setsCount: points.length,
            lateralMode: normalizedLateralMode,
            hasBilateralSets: lateralAvailability.hasBilateralSets,
            hasLeftSets: lateralAvailability.hasLeftSets,
            hasRightSets: lateralAvailability.hasRightSets,
            familyScopeDebug: familyScope?.debug || null,
            strengthPeak,
            strengthPeakNormalized: peak,
            strengthPeaksBySignature,
            setCountsBySignature,
            referenceVariationSignature: referenceSourceVariationSignature,
        }
    };
}

/**
 * Fetches the top exercises for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} by - Optional parameter to specify the field to group by
 * @param {string} asc - Optional parameter to specify the sort order
 * @param {string} seanceName - Optional seance name to filter by
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top exercises.
 */
async function getTopExercices(userId, by, asc, page = 1, limit = 3, seanceName = null) {
    try {
        let groupBy = "$seance";
        let sort = -1
        let totalField = "total";
        if (by) {
            if (by === "repetitions") {
                groupBy = "$value";
            }
            else if (by === "weightLoad") {
                groupBy = "$weightLoad";
            }
            else if (by === "elastic") {
                groupBy = "$elastic";
            }
        }
        if (groupBy === "$seance") {
            groupBy = 1;
            totalField = "seancesSize";
        }
        if (asc) {
            sort = 1
        }

        const agg = [
            {
                $lookup: {
                    from: 'seances',
                    localField: 'seance',
                    foreignField: '_id',
                    as: 'seanceDetails'
                }
            },
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    ...(seanceName && { 'seanceDetails.name': seanceName })
                }
            },
            //TODO: Change by variations
            { $group: { _id: ['$exercice', '$categories.category'], total: { $sum: groupBy }, seances: { $addToSet: "$seance" } } },
            {
                $addFields: {
                    seancesSize: { $size: "$seances" }
                }
            },
            {
                '$project': {
                    exercice: { '$arrayElemAt': ['$_id', 0] },
                    categories: { '$arrayElemAt': ['$_id', 1] },
                    total: 1,
                    seancesSize: 1,
                    _id: 0
                }
            },
            { $sort: { [totalField]: sort, exercice: 1, categories: 1 } },
        ];

        const countPipeline = [...agg, { $count: 'total' }];
        const dataPipeline = [...agg,
        { $skip: (page - 1) * limit },
        { $limit: limit }
        ];

        const [countResult, topExercices] = await Promise.all([
            Set.aggregate(countPipeline).exec(),
            Set.aggregate(dataPipeline).exec()
        ]);

        const total = countResult[0]?.total || 0;

        return {
            topExercices,
            total
        };
    } catch (err) {
        console.error("Error fetching top exercises:", err);
        throw err;
    }
}

/**
 * Get the my exercices for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} search - The search query.
 * @param {number} page - The page number.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercices.
 */
async function getMyExercicesSearch(userId, search, page, limit) {
    try {
        const db = mongoose.connection?.db;
        if (!db) {
            throw new Error('MongoDB connection is not ready');
        }

        const userIdObjectId = mongoose.Types.ObjectId.isValid(userId)
            ? new mongoose.Types.ObjectId(userId)
            : userId;

        const compound = buildMyExercisesSearchCompound({ search, userId: userIdObjectId });
        const countPipeline = [
            {
                $search: {
                    index: "default",
                    compound: compound
                },
            },
            {
                $group: {
                    _id: "$variations.variation",
                    count: { $sum: 1 }
                }
            }
        ];
        const [variations, totalResult] = await Promise.all([
            db.collection('seancesets').aggregate([
                ...countPipeline,
                {
                    $sort: {
                        count: -1
                    }
                },
                {
                    $skip: (page - 1) * limit
                },
                {
                    $limit: limit
                },
            ], { maxTimeMS: SEARCH_MAX_TIME_MS }).toArray(),
            db.collection('seancesets').aggregate([
                ...countPipeline,
                {
                    $count: "total"
                }
            ], { maxTimeMS: SEARCH_MAX_TIME_MS }).toArray()
        ]);

        const idsListofLists = variations.map(variation => variation._id.map(id => id.toString()));
        const variationIds = idsListofLists.flat();
        const variationsDocs = await Variation.find({ _id: { $in: variationIds } }, { mergedNamesEmbedding: 0 });
        const equivalentVerifiedBySignature = await getEquivalentVerifiedMapFromGroups(idsListofLists);

        const variationsWithDocs = variations.map(variation => {
            const ids = variation._id.map(id => id.toString());
            const signature = getVariationSignature(ids);
            const equivalentVariation = equivalentVerifiedBySignature.get(signature);

            if (equivalentVariation) {
                return {
                    ...variation,
                    _id: [equivalentVariation._id.toString()],
                    variations: [equivalentVariation]
                };
            }

            let variationsList = [];
            for (const id of ids) {
                const variationDoc = variationsDocs.find(variationDoc => variationDoc._id.toString() === id.toString());
                variationsList.push(variationDoc);
            }
            return {
                ...variation,
                _id: ids,
                variations: variationsList
            };
        });

        const total = totalResult.length > 0 ? totalResult[0].total : 0;
        return { variations: variationsWithDocs, total };
    } catch (err) {
        console.error("Error fetching my exercices:", err);
        throw err;
    }
}

/**
 * Get the my exercices for a user.
 * @param {string} userId - The ID of the user.
 * @param {number} page - The page number.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercices.
 */
async function getMyExercicesAll(userId, page, limit) {
    try {
        const db = mongoose.connection?.db;
        if (!db) {
            throw new Error('MongoDB connection is not ready');
        }
        const countPipeline = [
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId)
                }
            },
            {
                $group: {
                    _id: "$variations.variation",
                    count: { $sum: 1 }
                }
            }
        ];
        const [variations, totalResult] = await Promise.all([
            db.collection('seancesets').aggregate([
                ...countPipeline,
                {
                    $sort: {
                        count: -1
                    }
                },
                {
                    $skip: (page - 1) * limit
                },
                {
                    $limit: limit
                }
            ]).toArray(),
            db.collection('seancesets').aggregate([
                ...countPipeline,
                {
                    $count: "total"
                }
            ]).toArray()
        ]);

        const idsListofLists = variations.map(variation => variation._id.map(id => id.toString()));
        const variationIds = idsListofLists.flat();
        const variationsDocs = await Variation.find({ _id: { $in: variationIds } }, { mergedNamesEmbedding: 0 });
        const equivalentVerifiedBySignature = await getEquivalentVerifiedMapFromGroups(idsListofLists);

        const variationsWithDocs = variations.map(variation => {
            const ids = variation._id.map(id => id.toString());
            const signature = getVariationSignature(ids);
            const equivalentVariation = equivalentVerifiedBySignature.get(signature);

            if (equivalentVariation) {
                return {
                    ...variation,
                    _id: [equivalentVariation._id.toString()],
                    variations: [equivalentVariation]
                };
            }

            let variationsList = [];
            for (const id of ids) {
                const variationDoc = variationsDocs.find(variationDoc => variationDoc._id.toString() === id.toString());
                variationsList.push(variationDoc);
            }
            return {
                ...variation,
                _id: ids,
                variations: variationsList
            };
        });

        const total = totalResult.length > 0 ? totalResult[0].total : 0;
        return { variations: variationsWithDocs, total };
    } catch (err) {
        console.error("Error fetching my exercices:", err);
        throw err;
    }
}


/**
 * Get the top formats for a user and optionally a specific exercise.
 * @param {string} userId - The ID of the user.
 * @param {string} exercice - The ID of the exercice.
 * @param {Array<string>} categories - The array of category IDs.
 * @param {number} page - The page number to fetch.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top formats with their occurrences.
 */
async function getLastFormats(userId, exercice, categories, page = 1, limit = 5) {
    try {
        let match = { user: new mongoose.Types.ObjectId(userId) };
        if (exercice) {
            match.exercice = new mongoose.Types.ObjectId(exercice);
        }
        if (categories) {
            match.categories = { $size: categories.length, $all: categories.map(c => ({ $elemMatch: { category: new mongoose.Types.ObjectId(c) } })) };
        }

        const agg = [
            { $match: match },
            {
                $group: {
                    _id: {
                        exercice: "$exercice",
                        categories: "$categories.category",
                        seance: "$seance",
                        unit: "$unit"
                    },
                    sets: {
                        $push: "$$ROOT"
                    },
                    date: {
                        $first: "$date"
                    }
                }
            },
            {
                $project: {
                    "sets.value": 1,
                    "sets.elastic": 1,
                    "sets.weightLoad": 1,
                    "sets.unit": 1,
                    "sets.brzycki": 1,
                    "sets.epley": 1,
                    "sets.oneRepMaxIncludesBodyweight": 1,
                    "sets.oneRepMaxUserWeightKg": 1,
                    "sets.oneRepMaxExerciseBodyWeightRatio": 1,
                    "sets.brzyckiWithBodyweight": 1,
                    "sets.epleyWithBodyweight": 1,
                    "sets.effectiveWeightLoad": 1,
                    "sets.effectiveWeightLoadWithBodyweight": 1,
                    "sets.weightLoadLbs": 1,
                    "sets.effectiveWeightLoadLbs": 1,
                    "sets.effectiveWeightLoadWithBodyweightLbs": 1,
                    date: 1
                }
            },
            {
                $sort: {
                    date: -1
                }
            }
        ];

        const countPipeline = [...agg, { $count: 'total' }];
        const [countResult] = await Set.aggregate(countPipeline).exec();
        const total = countResult?.total || 0;

        const dataPipeline = [...agg,
        { $skip: (page - 1) * limit },
        { $limit: limit }
        ];
        const lastFormats = await Set.aggregate(dataPipeline).exec();

        return { lastFormats: lastFormats, total };
    } catch (err) {
        console.error("Error fetching last formats:", err);
        throw err;
    }
}

/**
 * Classify a set into one or multiple PR categories based on its unit and value.
 * Boundaries are inclusive (e.g. 3 reps is both Puissance and Force).
 */
function classifySet(unit, value) {
    const thresholds = PR_CATEGORIES[unit];
    if (!thresholds || value == null) return [];
    return thresholds
        .filter(t => value >= t.min && value <= t.max)
        .map(t => t.name);
}

function computePrsFromAugmentedSets(sets) {
    const prs = {
        Puissance: { repetitions: null, seconds: null },
        Force: { repetitions: null, seconds: null },
        Volume: { repetitions: null, seconds: null },
        Endurance: { repetitions: null, seconds: null },
        ATH: { repetitions: null, seconds: null },
        Last: { repetitions: null, seconds: null }
    };
    for (const set of sets) {
        const categoriesForSet = classifySet(set.unit, set.value);
        for (const category of categoriesForSet) {
            if (prs[category]) {
                prs[category][set.unit] = compareAndAssignPR(prs[category][set.unit], set);
            }
        }
        if (set?.unit && prs.ATH[set.unit] !== undefined) {
            prs.ATH[set.unit] = compareAndAssignPR(prs.ATH[set.unit], set);
        }
    }
    const repSets = sets.filter(s => s.unit === 'repetitions');
    const secSets = sets.filter(s => s.unit === 'seconds');
    prs.Last.repetitions = repSets[repSets.length - 1] || null;
    prs.Last.seconds = secSets[secSets.length - 1] || null;
    return prs;
}

function countUniqueSetIdsInDetailedPrs(prs) {
    if (!prs || typeof prs !== 'object') return 0;
    const ids = new global.Set();
    for (const key of Object.keys(prs)) {
        const rep = prs?.[key]?.repetitions;
        const sec = prs?.[key]?.seconds;
        if (rep?._id != null) ids.add(String(rep._id));
        if (sec?._id != null) ids.add(String(sec._id));
    }
    return ids.size;
}

function summarizePrEligibleAugmentedSets(augmented = []) {
    const byRmKey = new Map();
    const eligible = [];
    for (const set of augmented) {
        if (set?.unit !== 'repetitions' && set?.unit !== 'seconds') {
            eligible.push({
                id: set?._id != null ? String(set._id) : null,
                unit: set?.unit ?? null,
                value: set?.value ?? null,
                prEligible: false,
                reason: 'unsupported_unit',
            });
            continue;
        }
        const n = Math.floor(Number(set?.value));
        if (n < 1) {
            eligible.push({
                id: set?._id != null ? String(set._id) : null,
                unit: set?.unit ?? null,
                value: set?.value ?? null,
                prEligible: false,
                reason: 'value_below_1',
            });
            continue;
        }
        const rmKey = `${n}RM`;
        const row = {
            id: set?._id != null ? String(set._id) : null,
            unit: set?.unit,
            value: set?.value,
            prEligible: true,
            rmKey,
        };
        eligible.push(row);
        if (!byRmKey.has(rmKey)) byRmKey.set(rmKey, []);
        byRmKey.get(rmKey).push(row.id);
    }
    const collapsedRmSlots = [...byRmKey.entries()].map(([rmKey, ids]) => ({
        rmKey,
        setCount: ids.length,
        uniqueSetIds: [...new global.Set(ids.filter(Boolean))].length,
    }));
    return { eligible, collapsedRmSlots };
}

const SMITH_BENCH_GUIDED_VARIATION_ID = '6922144c1c858345acc2d0ce';
const BENCH_PRESS_VARIATION_ID = '669ced7e665a3ffe77714367';
const BARRE_GUIDEE_VARIATION_ID = '669c3609218324e0b7682ab9';
const SMITH_BENCH_COMBO_SIGNATURE = `${BARRE_GUIDEE_VARIATION_ID}|${BENCH_PRESS_VARIATION_ID}`;

function isSmithBenchGuidedProgressionDebugFocus(signature, nameFr = '') {
    const sig = String(signature || '');
    const name = String(nameFr || '').toLowerCase();
    if (sig === SMITH_BENCH_GUIDED_VARIATION_ID || sig.includes(SMITH_BENCH_GUIDED_VARIATION_ID)) return true;
    if (sig === SMITH_BENCH_COMBO_SIGNATURE) return true;
    return name.includes('developpe couche') && (name.includes('barre guidee') || name.includes('smith'));
}

function logHistoricalSetCountDiagnostics(target, {
    scopedSets = [],
    augmented = [],
    prs = null,
} = {}) {
    const nameFr = target?.name?.fr || target?.name?.en || '';
    const signature = String(target?.signature || '');
    const isZercherFocus = signature.includes('6922144d')
        || nameFr.toLowerCase().includes('zercher');
    const isSmithBenchFocus = isSmithBenchGuidedProgressionDebugFocus(signature, nameFr);
    if (!isZercherFocus && !isSmithBenchFocus) return;

    const prSummary = summarizePrEligibleAugmentedSets(augmented);
    const prUniqueSetIds = countUniqueSetIdsInDetailedPrs(prs);
    const prEligibleCount = prSummary.eligible.filter((row) => row.prEligible).length;
    const prSlotIdsByKey = {};
    for (const key of Object.keys(prs || {})) {
        const ids = [];
        const rep = prs?.[key]?.repetitions;
        const sec = prs?.[key]?.seconds;
        if (rep?._id != null) ids.push(String(rep._id));
        if (sec?._id != null) ids.push(String(sec._id));
        if (ids.length) prSlotIdsByKey[key] = ids;
    }
    console.debug('[Progression][HistoricalSetCount]', {
        signature,
        name: nameFr || null,
        familyTargetCount: target?.count ?? null,
        scopedSetsCount: scopedSets.length,
        augmentedSetsCount: augmented.length,
        prEligibleSetsCount: prEligibleCount,
        prUniqueSetIdsInSlots: prUniqueSetIds,
        prSlotIdsByKey,
        prCollapsedByRmKey: prSummary.collapsedRmSlots,
        note: 'UI historique = prUniqueSetIdsInSlots (ids uniques dans slots PR Last/nRM). Family count = tous les sets bruts. Écart typique = plusieurs sets au même nb de reps ne gardent qu\'un slot PR.',
        discrepancy: scopedSets.length !== prUniqueSetIds
            ? {
                scopedMinusPrSlots: scopedSets.length - prUniqueSetIds,
                ineligibleSets: prSummary.eligible.filter((row) => !row.prEligible),
            }
            : null,
    });
}

function computeDetailedPrsFromAugmentedSets(sets) {
    const prs = {
        Last: { repetitions: null, seconds: null }
    };
    for (const set of sets) {
        if (set.unit !== 'repetitions' && set.unit !== 'seconds') continue;
        const n = Math.floor(set.value);
        if (n < 1) continue;
        const rmKey = `${n}RM`;
        if (!prs[rmKey]) {
            prs[rmKey] = { repetitions: null, seconds: null };
        }
        prs[rmKey][set.unit] = compareAndAssignPR(prs[rmKey][set.unit], set);
    }
    const repSets = sets.filter(s => s.unit === 'repetitions');
    const secSets = sets.filter(s => s.unit === 'seconds');
    prs.Last.repetitions = repSets[repSets.length - 1] || null;
    prs.Last.seconds = secSets[secSets.length - 1] || null;
    return prs;
}

function mapAugmentedSetToFigurePoint(set, signature = null) {
    if (!set) return null;
    const setId = set._id != null ? String(set._id) : (set.setId != null ? String(set.setId) : null);
    return {
        setId,
        date: set.date ?? null,
        unit: set.unit ?? null,
        value: set.value ?? null,
        rawValue: set.value ?? null,
        rawWeightLoad: set.weightLoad ?? null,
        rawEffectiveWeightLoad: set.rawEffectiveWeightLoad ?? null,
        repsEquivalent: set.repsEquivalent ?? null,
        brzycki: set.brzycki ?? set.normalizedBrzycki ?? null,
        epley: set.epley ?? set.normalizedEpley ?? null,
        normalizedBrzycki: set.normalizedBrzycki ?? null,
        normalizedEpley: set.normalizedEpley ?? null,
        normalizedOneRm: set.normalizedOneRm ?? null,
        normalizedEffectiveWeightLoad: set.normalizedEffectiveWeightLoad ?? null,
        oneRepMaxIncludesBodyweight: set.oneRepMaxIncludesBodyweight === true,
        oneRepMaxUserWeightKg: set.oneRepMaxUserWeightKg ?? null,
        oneRepMaxExerciseBodyWeightRatio: set.oneRepMaxExerciseBodyWeightRatio ?? null,
        difficultyFactor: set.difficultyFactor ?? null,
        sourceVariationSignature: signature,
        seance: set.seance ?? null,
        seanceId: set.seance != null ? String(set.seance) : null,
    };
}

function computeRelativePeakForceDiff(entryOneRmReference, peakReferenceKg) {
    const setValue = Number(entryOneRmReference);
    const peakValue = Number(peakReferenceKg);
    if (!Number.isFinite(setValue) || !Number.isFinite(peakValue) || peakValue <= 0) {
        return null;
    }
    return Math.abs(peakValue - setValue) / peakValue;
}

function enrichPrSlotsWithPeakForceDiff(prs, peakReferenceKg) {
    if (!prs || typeof prs !== 'object') return prs;
    const enrichSlot = (slot) => {
        if (!slot || typeof slot !== 'object') return slot;
        const entryRef = Number(slot.normalizedOneRm);
        return {
            ...slot,
            peakForceDiff: computeRelativePeakForceDiff(entryRef, peakReferenceKg),
        };
    };
    const next = {};
    for (const [key, value] of Object.entries(prs)) {
        if (!value || typeof value !== 'object') {
            next[key] = value;
            continue;
        }
        next[key] = {
            repetitions: enrichSlot(value.repetitions),
            seconds: enrichSlot(value.seconds),
        };
    }
    return next;
}

async function fetchSetsForPR(userId, excludedSeanceId, exercice, categories, dateMin, variations, unilateralSide, variationsMatchMode = 'exact') {
    const query = { value: { $gt: 0 }, user: new mongoose.Types.ObjectId(userId) };

    if (excludedSeanceId) {
        query.seance = { $ne: new mongoose.Types.ObjectId(excludedSeanceId) };
    }

    if (exercice) {
        query.exercice = new mongoose.Types.ObjectId(exercice);
    }

    if (categories?.length) {
        const categoryIds = categories
            .map(c => JSON.parse(c))
            .map(c => new mongoose.Types.ObjectId(c.category));
        query.categories = {
            $size: categoryIds.length,
            $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
        };
    }

    let variationGroupsDebug = null;
    if (variations?.length) {
        const variationIds = (Array.isArray(variations) ? variations : [variations])
            .map(v => v.toString());
        const variationGroups = await getAlternativeVariationGroups(variationIds);
        variationGroupsDebug = variationGroups.map((group) => group.map((id) => String(id)));
        const variationQuery = variationsMatchMode === 'contains'
            ? buildVariationsContainmentQuery(variationGroups)
            : buildVariationsExactMatchQuery(variationGroups);

        if (variationQuery?.$or) {
            query.$or = variationQuery.$or;
        } else if (variationQuery?.variations) {
            query.variations = variationQuery.variations;
        }
    }

    if (dateMin) {
        const parsedDate = new Date(dateMin);
        if (!Number.isNaN(parsedDate.getTime())) {
            query.date = { $gte: parsedDate };
        }
    }
    if (unilateralSide !== undefined) {
        query.unilateralSide = unilateralSide;
    }

    const fetched = await Set.find(query).sort({ date: 1 }).exec();
    if (variations?.length) {
        const variationIdsDebug = (Array.isArray(variations) ? variations : [variations]).map((v) => String(v));
    }

    return fetched;
}

/**
 * PRs « classiques » : union des séries matchant les groupes equivalentTo + computePrsFn.
 * @deprecated Préférer getProgressionPRs ; conservé pour le best set workout (merge équivalents).
 */
async function computeClassicPrsFromVariationQuery({
    userId,
    excludedSeanceId = null,
    exercice = null,
    categories = null,
    dateMin = null,
    variations = null,
    unilateralSide = undefined,
    computePrsFn = computePrsFromAugmentedSets,
}) {
    const rawSets = await fetchSetsForPR(
        userId,
        excludedSeanceId,
        exercice,
        categories,
        dateMin,
        variations,
        unilateralSide,
    );
    let useCardioPrs = isCardioScopeSets(rawSets);
    if (!useCardioPrs && variations) {
        const variationIds = (Array.isArray(variations) ? variations : [variations])
            .filter(Boolean)
            .map((id) => String(id));
        if (variationIds.length > 0) {
            const variationDocs = await Variation.find(
                { _id: { $in: variationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
                { type: 1, defaultMode: 1 },
            ).lean();
            useCardioPrs = variationDocs.some((doc) => isCardioVariationDoc(doc));
        }
    }
    if (useCardioPrs) {
        const cardioSets = filterCardioSets(rawSets);
        return {
            prs: computeCardioPrsFromSets(cardioSets),
            rawSets,
            augmentedSets: cardioSets,
        };
    }
    const sets = await augmentSetsWithNormalizedMetrics({
        sets: rawSets,
        userId,
        referenceVariations: variations,
        mainExerciseId: exercice,
    });
    return {
        prs: computePrsFn(sets),
        rawSets,
        augmentedSets: sets,
    };
}

/**
 * Get PRs for a user.
 * @deprecated Utiliser getProgressionPRs (canonique). Conservé pour GET /prs / best set workout.
 * @param {string} userId - The ID of the user.
 * @param {string} excludedSeanceId - The seance ID to exclude from PR computation (optional).
 * @param {string} exercice - The ID of the exercice (optional).
 * @param {Array<string>} categories - The array of category JSON strings (optional).
 * @param {string} dateMin - The minimum date (optional).
 * @param {Array<string>} variations - The array of variation IDs (optional).
 * @returns {Promise<Object>} - PRs categorized by Puissance/Force/Volume/Endurance/ATH, plus Last.
 */
async function getPRs(userId, excludedSeanceId, exercice, categories, dateMin, variations, unilateralSide) {
    try {
        const variationIds = (Array.isArray(variations) ? variations : [variations])
            .filter(Boolean)
            .map((id) => String(id));
        const variationGroups = variationIds.length > 0
            ? await getAlternativeVariationGroups(variationIds)
            : [];
        const { prs, rawSets, augmentedSets: sets } = await computeClassicPrsFromVariationQuery({
            userId,
            excludedSeanceId,
            exercice,
            categories,
            dateMin,
            variations,
            unilateralSide,
            computePrsFn: computePrsFromAugmentedSets,
        });
        if (isPrDebugLoggingEnabled() && variationIds.length > 0) {
            const repCandidates = (sets || [])
                .filter((s) => s?.unit === 'repetitions')
                .map((s) => ({
                    setId: s?._id != null ? String(s._id) : null,
                    value: s?.value,
                    weightLoad: s?.weightLoad,
                    normalizedOneRm: s?.normalizedOneRm ?? null,
                    oneRmKg: resolvePrComparisonOneRmKg(s),
                    variations: getVariationIdsFromSetDoc(s),
                }))
                .sort((a, b) => (b.oneRmKg ?? 0) - (a.oneRmKg ?? 0));
            logPrEval('getPRs', {
                variationIds,
                variationGroups,
                excludedSeanceId: excludedSeanceId != null ? String(excludedSeanceId) : null,
                mainExerciseId: exercice != null ? String(exercice) : null,
                rawSetCount: Array.isArray(rawSets) ? rawSets.length : 0,
                augmentedSetCount: Array.isArray(sets) ? sets.length : 0,
                athRepetitions: summarizeSetForPrLog(prs?.ATH?.repetitions),
                topOneRmCandidates: repCandidates.slice(0, 5),
            });
        }
        return prs;
    } catch (err) {
        console.error("Error fetching PRs:", err);
        throw err;
    }
}

/**
 * PRs par nombre de reps / secondes (nRM), sans regroupement par catégorie physiologique.
 * @deprecated Utiliser getProgressionDetailedPRs (canonique).
 * Chaque clé `"nRM"` contient le meilleur set pour `repetitions` et pour `seconds` à cette valeur n (arrondi par le bas).
 * @returns {Promise<Object>} - { "1RM": { repetitions, seconds }, "2RM": {...}, ..., Last: { repetitions, seconds } }
 */
async function getDetailedPRs(userId, exercice, categories, dateMin, variations, unilateralSide) {
    try {
        const { prs } = await computeClassicPrsFromVariationQuery({
            userId,
            excludedSeanceId: null,
            exercice,
            categories,
            dateMin,
            variations,
            unilateralSide,
            computePrsFn: computeDetailedPrsFromAugmentedSets,
        });
        return prs;
    } catch (err) {
        console.error("Error fetching detailed PRs:", err);
        throw err;
    }
}

async function collectGraphVariationNodeIdsForContext(normalizedMainExerciseId) {
    if (!normalizedMainExerciseId || !mongoose.Types.ObjectId.isValid(normalizedMainExerciseId)) {
        return [];
    }
    const edges = await VariationProgressionEdge.find(
        {
            isActive: true,
            $or: [
                { contextVariationId: new mongoose.Types.ObjectId(normalizedMainExerciseId) },
                { contextVariationId: null }
            ]
        },
        { fromVariationId: 1, toVariationId: 1 }
    ).lean();
    const out = new global.Set();
    for (const edge of edges) {
        if (edge.fromVariationId) out.add(String(edge.fromVariationId));
        if (edge.toVariationId) out.add(String(edge.toVariationId));
    }
    return [...out];
}

function getPreferredVariationLabel(variationDoc) {
    if (!variationDoc?.name) return null;
    return variationDoc.name.fr || variationDoc.name.en || null;
}

function buildFamilyLabelFromPrefix(prefixIds, variationById) {
    const labels = (prefixIds || [])
        .map((id) => getPreferredVariationLabel(variationById.get(String(id))))
        .filter(Boolean);
    if (!labels.length) return null;
    return labels.join(' > ');
}

async function getNormalFlowPerformedVariationFamilies({
    userId,
    variations,
    maxDepth = undefined,
    dateMin = null,
    unilateralSide = undefined,
    lateralMode = undefined,
}) {
    const inputVariationIdsRaw = (Array.isArray(variations) ? variations : [variations])
        .map((id) => String(id))
        .filter(Boolean);
    if (!inputVariationIdsRaw.length) {
        throw new Error('variations invalide: liste vide');
    }
    if (!inputVariationIdsRaw.every((id) => mongoose.Types.ObjectId.isValid(id))) {
        throw new Error('variations invalide: ids invalides');
    }
    const inputVariationIds = [...new global.Set(inputVariationIdsRaw)];

    // Normalise l'ordre de sélection pour éviter une divergence de scope
    // entre endpoints (family vs timeseries/PRs) selon l'ordre d'entrée.
    // Règle: exercices d'abord, puis tri lexicographique stable.
    const orderedInputVariationIds = inputVariationIds.length > 1
        ? await (async () => {
            const docs = await Variation.find(
                { _id: { $in: inputVariationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
                { isExercice: 1 }
            ).lean();
            const isExerciseById = new Map(docs.map((doc) => [String(doc._id), doc?.isExercice === true]));
            return [...inputVariationIds].sort((a, b) => {
                const aIsEx = isExerciseById.get(String(a)) === true;
                const bIsEx = isExerciseById.get(String(b)) === true;
                if (aIsEx !== bIsEx) return aIsEx ? -1 : 1;
                return String(a).localeCompare(String(b));
            });
        })()
        : inputVariationIds;

    let familySeedIds = [];
    if (orderedInputVariationIds.length === 1) {
        const rootVariationIdStr = String(orderedInputVariationIds[0]);
        const rootVariationDoc = await Variation.findById(
            rootVariationIdStr,
            { equivalentTo: 1, isExercice: 1 }
        ).lean();
        familySeedIds = resolveFamilySeedIds(rootVariationIdStr, rootVariationDoc);
    } else {
        const inputDocs = await Variation.find(
            { _id: { $in: orderedInputVariationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
            { equivalentTo: 1, isExercice: 1 },
        ).lean();
        const inputVariationById = new Map(inputDocs.map((doc) => [String(doc._id), doc]));
        familySeedIds = resolveMultiInputFamilySeedIds(orderedInputVariationIds, inputVariationById);
        console.debug('[Progression][FamilyScope][MultiInput]', {
            userId: String(userId || ''),
            orderedInputVariationIds,
            familySeedIds,
            primaryExerciseId: orderedInputVariationIds.find(
                (id) => inputVariationById.get(String(id))?.isExercice === true,
            ) || orderedInputVariationIds[0],
            note: 'multi-input: equivalentTo path from primary exercise + extra selection ids',
        });
    }
    if (!familySeedIds.length) {
        throw new Error('impossible de construire la famille à partir de variations');
    }
    const rootExerciseId = await resolveFamilyAnchorId({
        variationId: orderedInputVariationIds[0],
        variationIds: orderedInputVariationIds,
    }) || String(familySeedIds[0]);
    const rootVariationIdStr = String(orderedInputVariationIds[0]);

    const depthInput = Number(maxDepth);
    const maxDepthAppliedRaw = Number.isFinite(depthInput)
        ? Math.max(1, Math.min(Math.floor(depthInput), NORMAL_FLOW_FAMILY_MAX_DEPTH))
        : NORMAL_FLOW_FAMILY_MAX_DEPTH;
    const maxDepthApplied = Math.max(
        1,
        Math.min(
            maxDepthAppliedRaw,
            familySeedIds.length > 0 ? familySeedIds.length : 1
        )
    );
    if (orderedInputVariationIds.length > 1) {
        console.debug('[Progression][FamilyScope][MultiInputDepth]', {
            userId: String(userId || ''),
            orderedInputVariationIds,
            familySeedIds,
            maxDepthRequested: maxDepthAppliedRaw,
            maxDepthApplied,
            note: 'multi-input: maxDepthApplied capped to familySeedIds.length',
        });
    }

    const rawSets = await fetchSetsForPR(
        userId,
        null,
        null,
        null,
        dateMin,
        null,
        unilateralSide
    );
    let familySets = Array.isArray(rawSets) ? rawSets : [];
    if (lateralMode != null) {
        familySets = filterSetsByLateralMode(familySets, normalizeLateralMode(lateralMode));
    }

    if (!familySets.length) {
        return {
            families: [],
            performedVariationsByFamily: {},
            meta: {
                rootVariationId: rootVariationIdStr,
                rootExerciseId,
                maxDepthApplied,
                maxFamiliesApplied: NORMAL_FLOW_MAX_FAMILIES
            }
        };
    }

    const allVariationIds = new global.Set([rootExerciseId, ...familySeedIds, ...orderedInputVariationIds]);
    for (const setDoc of familySets) {
        for (const id of getVariationIdsFromSetDoc(setDoc)) {
            allVariationIds.add(String(id));
        }
    }

    const variationDocs = await Variation.find(
        { _id: { $in: [...allVariationIds].map((id) => new mongoose.Types.ObjectId(id)) } },
        { name: 1, equivalentTo: 1, isExercice: 1 }
    ).lean();
    const variationById = new Map(variationDocs.map((doc) => [String(doc._id), doc]));
    const familyPrefixes = familySeedIds.length > 0
        ? buildVariationPrefixes(familySeedIds, maxDepthApplied)
        : [[rootExerciseId]];
    const limitedFamilyPrefixes = familyPrefixes.slice(0, NORMAL_FLOW_MAX_FAMILIES);

    const matchFamilyInSet = (familyIds, setVariationIds, setEquivalentToIds) => {
        const allInVariations = familyIds.every((id) => setVariationIds.includes(String(id)));
        if (allInVariations) return true;
        return familyIds.every((id) => setEquivalentToIds.has(String(id)));
    };

    const chooseRepresentativeVariationId = (setVariationIds, setEquivalentToIds, familyIds) => {
        const firstExercise = setVariationIds.find((id) => variationById.get(String(id))?.isExercice === true);
        if (firstExercise) return String(firstExercise);
        const directFamilyMatch = familyIds.find((id) => setVariationIds.includes(String(id)));
        if (directFamilyMatch) return String(directFamilyMatch);
        const fromEquivalentTo = familyIds.find((id) => setEquivalentToIds.has(String(id)));
        if (fromEquivalentTo) return String(fromEquivalentTo);
        return String(setVariationIds[0] || rootExerciseId);
    };

    const performedVariationsByFamily = {};
    const families = [];

    for (const prefixIds of limitedFamilyPrefixes) {
        const familyKey = prefixIds.join('|');
        const groupedByVariationSignature = new Map();
        let familyPerformedCount = 0;
        let familyLastPerformedAt = null;
        let orderSeenCursor = 0;

        for (const setDoc of familySets) {
            const setVariationIds = getVariationIdsFromSetDoc(setDoc);
            if (!setVariationIds.length) continue;

            const setEquivalentToIds = new global.Set();
            for (const variationId of setVariationIds) {
                const eq = variationById.get(String(variationId))?.equivalentTo || [];
                for (const id of eq) {
                    setEquivalentToIds.add(String(id));
                }
            }

            if (!matchFamilyInSet(prefixIds, setVariationIds, setEquivalentToIds)) {
                continue;
            }

            const expandedVariationIds = resolveExpandedLeafVariationIds(setVariationIds, variationById);
            const variationSignature = getVariationSignature(expandedVariationIds);
            const sortedVariationIds = expandedVariationIds;
            const representativeVariationId = chooseRepresentativeVariationId(setVariationIds, setEquivalentToIds, prefixIds);

            if (!groupedByVariationSignature.has(variationSignature)) {
                groupedByVariationSignature.set(variationSignature, {
                    variations: sortedVariationIds,
                    variationOrderCounts: new Map(),
                    mergedNameCounts: new Map(),
                    variationCandidateCounts: new Map(),
                    count: 0,
                    minDate: null,
                    maxDate: null
                });
            }
            const row = groupedByVariationSignature.get(variationSignature);
            row.count += 1;
            familyPerformedCount += 1;
            const originalOrderSignature = setVariationIds.join('|');
            const previousOrderStats = row.variationOrderCounts.get(originalOrderSignature);
            if (!previousOrderStats) {
                row.variationOrderCounts.set(originalOrderSignature, {
                    count: 1,
                    firstSeenAt: orderSeenCursor,
                    order: [...setVariationIds]
                });
            } else {
                previousOrderStats.count += 1;
            }
            orderSeenCursor += 1;

            const mergedName = typeof setDoc?.mergedVariationsNames?.fr === 'string'
                ? setDoc.mergedVariationsNames.fr.trim()
                : '';
            if (mergedName) {
                row.mergedNameCounts.set(mergedName, (row.mergedNameCounts.get(mergedName) || 0) + 1);
            }

            const previousCandidateCount = row.variationCandidateCounts.get(representativeVariationId) || 0;
            row.variationCandidateCounts.set(representativeVariationId, previousCandidateCount + 1);

            const setDate = setDoc?.date ? new Date(setDoc.date) : null;
            if (setDate && !Number.isNaN(setDate.getTime())) {
                if (!row.minDate || setDate < row.minDate) row.minDate = setDate;
                if (!row.maxDate || setDate > row.maxDate) row.maxDate = setDate;
                if (!familyLastPerformedAt || setDate > familyLastPerformedAt) familyLastPerformedAt = setDate;
            }
        }

        const rows = [...groupedByVariationSignature.entries()].map(([variationSignature, aggregate]) => {
            const preferredVariationId = [...aggregate.variationCandidateCounts.entries()]
                .sort((a, b) => b[1] - a[1])[0]?.[0] || rootExerciseId;
            const scopedVariationId = String(preferredVariationId);
            const preferredVariationDoc = variationById.get(String(preferredVariationId)) || null;
            const preferredOrder = [...aggregate.variationOrderCounts.values()]
                .sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return a.firstSeenAt - b.firstSeenAt;
                })[0]?.order || aggregate.variations;
            const fallbackLabel = getPreferredVariationLabel(preferredVariationDoc)
                || aggregate.variations.join(' + ')
                || rootVariationIdStr;
            const bestMergedName = [...aggregate.mergedNameCounts.entries()]
                .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
            const label = bestMergedName || fallbackLabel;

            const chartSourceVariationIds = resolveChartSourceVariationIds(preferredOrder, variationById);
            const chartSourceVariationSignature = chartSourceVariationIds.length > 0
                ? toSortedSignature(chartSourceVariationIds)
                : variationSignature;

            return {
                variationId: String(preferredVariationId),
                scopedVariationId,
                scopeVariationIds: String(scopedVariationId) === String(preferredVariationId)
                    ? [String(preferredVariationId)]
                    : [String(rootExerciseId), String(preferredVariationId)],
                variations: preferredOrder,
                sourceVariationIds: preferredOrder,
                equivalentTo: Array.isArray(preferredVariationDoc?.equivalentTo)
                    ? preferredVariationDoc.equivalentTo.map((id) => String(id))
                    : [],
                name: { fr: label, en: null },
                fallbackMergedName: null,
                isExercice: preferredVariationDoc?.isExercice === true,
                progressionSignature: variationSignature,
                chartSourceVariationIds,
                chartSourceVariationSignature,
                count: aggregate.count,
                minDate: aggregate.minDate,
                maxDate: aggregate.maxDate,
                lastDate: aggregate.maxDate
            };
        }).sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return String(a.name?.fr || '').localeCompare(String(b.name?.fr || ''));
        });

        performedVariationsByFamily[familyKey] = rows;
        families.push({
            familyKey,
            depth: prefixIds.length,
            label: buildFamilyLabelFromPrefix(prefixIds, variationById),
            memberVariationIds: [...new global.Set(rows.map((row) => row.variationId))],
            performedCount: familyPerformedCount,
            lastPerformedAt: familyLastPerformedAt
        });
    }

    const debugScopeSignatures = new global.Set(
        Object.values(performedVariationsByFamily || {})
            .flatMap((items) => (Array.isArray(items) ? items : []))
            .flatMap((row) => [row?.chartSourceVariationSignature, row?.progressionSignature].filter(Boolean)),
    );
    console.debug('[Progression][FamilyScope]', {
        userId: String(userId || ''),
        inputVariationIds: orderedInputVariationIds,
        rootExerciseId,
        maxDepthApplied,
        familiesCount: families.length,
        rowsCount: Object.values(performedVariationsByFamily || {})
            .reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0),
        signatureCount: debugScopeSignatures.size,
        sampleSignatures: [...debugScopeSignatures].slice(0, 12),
    });

    return {
        families,
        performedVariationsByFamily,
        meta: {
            inputVariations: orderedInputVariationIds,
            familySeedVariations: familySeedIds,
            rootExerciseId,
            maxDepthApplied,
            maxFamiliesApplied: NORMAL_FLOW_MAX_FAMILIES,
            signatureCount: debugScopeSignatures.size,
            sampleSignatures: [...debugScopeSignatures].slice(0, 12),
        }
    };
}

async function resolveFamilyScopeSignaturesForTimeseries({
    userId,
    referenceVariationIds,
    dateMin = null,
    lateralMode = null,
    familyKey = null,
}) {
    const useFilteredScope = lateralMode != null || dateMin != null || familyKey != null;
    if (!useFilteredScope) {
        return resolveFamilyScopeSignaturesForTimeseriesLegacy({
            userId,
            referenceVariationIds,
        });
    }
    const allowlist = await resolveFigureRecommendationAllowlist({
        userId,
        referenceVariations: referenceVariationIds,
        familyKey,
        dateMin,
        lateralMode: lateralMode || 'bilateral',
        includeAllGraphTargets: false,
    });
    return {
        signatures: allowlist.signatures.size > 0 ? allowlist.signatures : null,
        debug: allowlist.familyScopeDebug,
    };
}

/**
 * Rows FAMILY identiques au picker /variation-family/performed.
 */
async function resolvePerformedFamilyTargets({
    userId,
    variations,
    familyKey = null,
    dateMin = null,
    lateralMode = 'bilateral',
    maxDepth = undefined,
}) {
    const normalizedLateralMode = normalizeLateralMode(lateralMode);
    const unilateralSide = normalizedLateralMode === 'left'
        ? 'left'
        : normalizedLateralMode === 'right'
            ? 'right'
            : undefined;
    const payload = await getNormalFlowPerformedVariationFamilies({
        userId,
        variations,
        maxDepth: maxDepth ?? NORMAL_FLOW_FAMILY_MAX_DEPTH,
        dateMin,
        unilateralSide,
        lateralMode: normalizedLateralMode,
    });
    const performedByFamily = payload?.performedVariationsByFamily || {};
    let rows = [];
    if (familyKey && Array.isArray(performedByFamily[familyKey])) {
        rows = performedByFamily[familyKey];
    } else {
        rows = Object.values(performedByFamily).flatMap((items) => (Array.isArray(items) ? items : []));
    }
    const signatures = new global.Set(
        rows.flatMap((row) => [row?.chartSourceVariationSignature, row?.progressionSignature].filter(Boolean)),
    );
    return {
        rows,
        signatures,
        families: payload?.families || [],
        performedVariationsByFamily: performedByFamily,
        meta: payload?.meta || null,
        familyScopeDebug: {
            inputVariationIds: payload?.meta?.inputVariations || [],
            familyKey: familyKey || null,
            rowsCount: rows.length,
            signatureCount: signatures.size,
            sampleSignatures: [...signatures].slice(0, 12),
        },
    };
}

/** Voisins 1-hop du graphe progression depuis des IDs family (union additive). */
async function collectProgressionEdgeNeighbors(seedVariationIds = []) {
    const seeds = [...new global.Set((seedVariationIds || []).map((id) => String(id)).filter(Boolean))];
    if (seeds.length === 0) return [];

    const seedObjectIds = seeds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    if (seedObjectIds.length === 0) return [];

    const edges = await VariationProgressionEdge.find(
        {
            isActive: true,
            $or: [
                { fromVariationId: { $in: seedObjectIds } },
                { toVariationId: { $in: seedObjectIds } },
            ],
        },
        { fromVariationId: 1, toVariationId: 1 },
    ).lean();

    const neighbors = new global.Set();
    const seedSet = new global.Set(seeds);
    for (const edge of edges) {
        const from = edge?.fromVariationId ? String(edge.fromVariationId) : null;
        const to = edge?.toVariationId ? String(edge.toVariationId) : null;
        if (from && seedSet.has(from) && to && !seedSet.has(to)) neighbors.add(to);
        if (to && seedSet.has(to) && from && !seedSet.has(from)) neighbors.add(from);
    }
    return [...neighbors];
}

const FRONT_LEVER_ROOT_VARIATION_ID = '669ced7e665a3ffe77714383';
const TUCK_FRONT_LEVER_VARIATION_ID = '692214541c858345acc2d41a';

function isFrontLeverFigureGraphDebugFocus(mainExerciseId, referenceIds = []) {
    const refs = (referenceIds || []).map(String);
    const main = mainExerciseId ? String(mainExerciseId) : '';
    return main === TUCK_FRONT_LEVER_VARIATION_ID
        || main === FRONT_LEVER_ROOT_VARIATION_ID
        || refs.includes(TUCK_FRONT_LEVER_VARIATION_ID);
}

async function collectGenericGraphVariationNodeIds() {
    const edges = await VariationProgressionEdge.find(
        { isActive: true, contextVariationId: null },
        { fromVariationId: 1, toVariationId: 1 },
    ).lean();
    const out = new global.Set();
    for (const edge of edges) {
        if (edge.fromVariationId) out.add(String(edge.fromVariationId));
        if (edge.toVariationId) out.add(String(edge.toVariationId));
    }
    return [...out];
}

/**
 * Cibles graphe pour modales figure : graphe complet (generic + scoped) ou 1-hop legacy.
 */
async function resolveFigureGraphTargetVariationIds({
    mainExerciseId = null,
    familyVariationIds = [],
    includeAllGraphTargets = false,
    expandGenericTargets = true,
}) {
    if (!includeAllGraphTargets) return [];

    if (expandGenericTargets === false) {
        return collectProgressionEdgeNeighbors(familyVariationIds);
    }

    if (!mainExerciseId) {
        return collectProgressionEdgeNeighbors(familyVariationIds);
    }

    const normalizedMainExerciseId = await resolveMainExerciseIdForProgression(String(mainExerciseId));
    const graphContextId = await resolveGraphContextVariationId(normalizedMainExerciseId);
    const graphNodeIds = graphContextId
        ? await collectGraphVariationNodeIdsForContext(graphContextId)
        : [];
    if (!graphNodeIds.length) return [];

    const familySet = new global.Set((familyVariationIds || []).map(String));
    const candidateIds = graphNodeIds
        .map(String)
        .filter((id) => !familySet.has(id));
    if (!candidateIds.length) return [];

    const docs = await Variation.find(
        { _id: { $in: candidateIds.map((id) => new mongoose.Types.ObjectId(id)) } },
        { isExercice: 1, name: 1, possibleProgression: 1 },
    ).lean();
    const docById = new Map(docs.map((doc) => [String(doc._id), doc]));

    return candidateIds
        .filter((id) => {
            const doc = docById.get(id);
            return doc && doc.possibleProgression !== false;
        })
        .sort((a, b) => {
            const aDoc = docById.get(a);
            const bDoc = docById.get(b);
            const aIsEx = aDoc?.isExercice === true ? 1 : 0;
            const bIsEx = bDoc?.isExercice === true ? 1 : 0;
            if (aIsEx !== bIsEx) return bIsEx - aIsEx;
            const aName = aDoc?.name?.fr || aDoc?.name?.en || '';
            const bName = bDoc?.name?.fr || bDoc?.name?.en || '';
            return aName.localeCompare(bName);
        });
}

async function logFigureGraphTargetsDiagnostics({
    referenceIds = [],
    mainExerciseId = null,
    familyVariationIds = [],
    oneHopEdgeIds = [],
    graphTargetVariationIds = [],
    expandGenericTargets = true,
    targetVariationIds = [],
    capped = false,
    safeMax = 40,
}) {
    const shouldLog = isFrontLeverFigureGraphDebugFocus(mainExerciseId, referenceIds);
    if (!shouldLog) return;

    let normalizedMainExerciseId = mainExerciseId ? String(mainExerciseId) : null;
    if (normalizedMainExerciseId) {
        normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    }
    const graphContextId = normalizedMainExerciseId
        ? await resolveGraphContextVariationId(normalizedMainExerciseId)
        : null;
    const fullGraphNodeIds = graphContextId
        ? await collectGraphVariationNodeIdsForContext(graphContextId)
        : [];
    const genericGraphNodeIds = await collectGenericGraphVariationNodeIds();

    const allowlistIdSet = new global.Set((targetVariationIds || []).map(String));
    const familySet = new global.Set((familyVariationIds || []).map(String));
    const oneHopSet = new global.Set((oneHopEdgeIds || []).map(String));
    const graphTargetSet = new global.Set((graphTargetVariationIds || []).map(String));
    const fullGraphSet = new global.Set(fullGraphNodeIds.map(String));

    const missingFromAllowlist = fullGraphNodeIds.filter((id) => !allowlistIdSet.has(String(id)));
    const missingGenericFromAllowlist = genericGraphNodeIds.filter((id) => !allowlistIdSet.has(String(id)));

    const focusExerciseIds = [
        '692214541c858345acc2d420',
        '692214541c858345acc2d423',
        '692214541c858345acc2d426',
    ];
    const focusNames = await Variation.find(
        { _id: { $in: focusExerciseIds.map((id) => new mongoose.Types.ObjectId(id)) } },
        { name: 1 },
    ).lean();
    const nameById = new Map(focusNames.map((doc) => [
        String(doc._id),
        doc?.name?.fr || doc?.name?.en || String(doc._id),
    ]));

    console.debug('[Progression][FigureGraphTargets]', {
        referenceIds,
        mainExerciseId: mainExerciseId ? String(mainExerciseId) : null,
        normalizedMainExerciseId,
        graphContextId,
        familyVariationIds,
        oneHopEdgeIds,
        graphTargetVariationIds,
        expandGenericTargets: expandGenericTargets !== false,
        graphTargetMode: expandGenericTargets === false ? 'one_hop' : 'full_graph',
        allowlistTargetCount: targetVariationIds.length,
        capped,
        maxTargetsApplied: safeMax,
        fullGraphNodeCount: fullGraphNodeIds.length,
        genericGraphNodeCount: genericGraphNodeIds.length,
        missingFromAllowlistCount: missingFromAllowlist.length,
        missingGenericFromAllowlistCount: missingGenericFromAllowlist.length,
        focusProgressionSteps: focusExerciseIds.map((id) => ({
            id,
            name: nameById.get(id) || id,
            inFamily: familySet.has(id),
            inOneHop: oneHopSet.has(id),
            inGraphTargets: graphTargetSet.has(id),
            inFullGraph: fullGraphSet.has(id),
            inAllowlist: allowlistIdSet.has(id),
        })),
        sampleMissingFromAllowlist: missingFromAllowlist.slice(0, 20),
        sampleMissingGenericFromAllowlist: missingGenericFromAllowlist.slice(0, 20),
        note: 'expandGenericTargets=true → collectGraphVariationNodeIdsForContext; false → collectProgressionEdgeNeighbors (1-hop).',
    });
}

/**
 * Allowlist modales figure : rows FAMILY + union edges progression liés.
 */
async function resolveFigureRecommendationAllowlist({
    userId,
    referenceVariations,
    mainExerciseId = null,
    familyKey = null,
    dateMin = null,
    lateralMode = 'bilateral',
    includeAllGraphTargets = false,
    expandGenericTargets = true,
    maxTargets = 40,
}) {
    const referenceIds = await resolveReferenceVariationIdsForProgression({
        referenceVariations,
        mainExerciseId,
    });
    const referenceIdList = referenceIds.map((id) => String(id)).filter(Boolean);
    const referenceIdSet = new global.Set(referenceIdList);
    const referenceVariationById = await buildVariationByIdMapFromSetsAsync([], referenceIds);
    const referenceSourceIds = resolveChartSourceVariationIds(referenceIdList, referenceVariationById);
    const referenceSignature = referenceSourceIds.length
        ? toSortedSignature(referenceSourceIds)
        : null;
    const familyPayload = await resolvePerformedFamilyTargets({
        userId,
        variations: referenceIds,
        familyKey,
        dateMin,
        lateralMode,
    });
    const familyRows = familyPayload.rows || [];
    const familyVariationIds = familyRows.map((row) => String(row.variationId)).filter(Boolean);
    const uniqueFamilyRowIds = [];
    for (const id of familyVariationIds) {
        if (!uniqueFamilyRowIds.includes(id)) uniqueFamilyRowIds.push(id);
    }
    const familyIdSet = new global.Set(uniqueFamilyRowIds);

    const oneHopEdgeIds = includeAllGraphTargets
        ? await collectProgressionEdgeNeighbors(uniqueFamilyRowIds)
        : [];
    const graphTargetVariationIds = includeAllGraphTargets
        ? await resolveFigureGraphTargetVariationIds({
            mainExerciseId,
            familyVariationIds: uniqueFamilyRowIds,
            includeAllGraphTargets,
            expandGenericTargets,
        })
        : [];
    const edgeVariationIds = graphTargetVariationIds;

    const signatures = new global.Set(familyPayload.signatures || []);
    if (referenceSignature) signatures.add(referenceSignature);
    const edgeIdSet = new global.Set();

    const safeMax = Math.max(1, Math.min(200, Number(maxTargets) || 40));
    const orderedVariationIds = [...referenceIdList];
    for (const id of uniqueFamilyRowIds) {
        if (!orderedVariationIds.includes(id)) orderedVariationIds.push(id);
    }
    for (const edgeId of edgeVariationIds) {
        const id = String(edgeId);
        if (!orderedVariationIds.includes(id)) orderedVariationIds.push(id);
    }
    const capped = orderedVariationIds.length > safeMax;
    let targetVariationIds;
    if (!capped) {
        targetVariationIds = orderedVariationIds;
    } else {
        const reservedIds = orderedVariationIds.filter((id) => referenceIdSet.has(String(id)));
        const otherIds = orderedVariationIds.filter((id) => !referenceIdSet.has(String(id)));
        targetVariationIds = [
            ...reservedIds,
            ...otherIds.slice(0, Math.max(0, safeMax - reservedIds.length)),
        ];
    }
    for (const id of targetVariationIds) {
        if (!familyIdSet.has(String(id)) && !referenceIdSet.has(String(id))) {
            edgeIdSet.add(String(id));
        }
    }

    if (includeAllGraphTargets) {
        await logFigureGraphTargetsDiagnostics({
            referenceIds,
            mainExerciseId,
            familyVariationIds: uniqueFamilyRowIds,
            oneHopEdgeIds,
            graphTargetVariationIds,
            expandGenericTargets,
            targetVariationIds,
            capped,
            safeMax,
        });
    }

    return {
        referenceIds,
        familyRows,
        targetVariationIds,
        variationIds: new global.Set(targetVariationIds),
        signatures,
        familyVariationIds: familyIdSet,
        edgeVariationIds: edgeIdSet,
        familyScopeDebug: {
            ...(familyPayload.familyScopeDebug || {}),
            edgeCount: edgeIdSet.size,
            graphTargetCount: graphTargetVariationIds.length,
            oneHopEdgeCount: oneHopEdgeIds.length,
            includeAllGraphTargets: Boolean(includeAllGraphTargets),
            expandGenericTargets: expandGenericTargets !== false,
            graphTargetMode: includeAllGraphTargets
                ? (expandGenericTargets === false ? 'one_hop' : 'full_graph')
                : 'none',
            capped,
            maxTargetsApplied: safeMax,
        },
    };
}

async function resolveFamilyScopeSignaturesForTimeseriesLegacy({
    userId,
    referenceVariationIds,
}) {
    const ids = (Array.isArray(referenceVariationIds) ? referenceVariationIds : [])
        .map((id) => String(id))
        .filter(Boolean);
    if (ids.length === 0) {
        return {
            signatures: null,
            debug: {
                inputVariationIds: ids,
                familiesCount: 0,
                rowsCount: 0,
                signatureCount: 0,
                sampleSignatures: [],
            },
        };
    }

    const payload = await getNormalFlowPerformedVariationFamilies({
        userId,
        variations: ids,
        maxDepth: NORMAL_FLOW_FAMILY_MAX_DEPTH,
        dateMin: null,
        unilateralSide: undefined,
    });

    const rows = Object.values(payload?.performedVariationsByFamily || {})
        .flatMap((items) => (Array.isArray(items) ? items : []));
    const signatures = new global.Set(
        rows.flatMap((row) => [
            row?.chartSourceVariationSignature,
            row?.progressionSignature,
        ].filter(Boolean)),
    );
    return {
        signatures: signatures.size > 0 ? signatures : null,
        debug: {
            inputVariationIds: ids,
            familiesCount: Array.isArray(payload?.families) ? payload.families.length : 0,
            rowsCount: rows.length,
            signatureCount: signatures.size,
            sampleSignatures: [...signatures].slice(0, 12),
        },
    };
}

async function collectTargetSignaturesForProgressionFamily({
    familySets,
    referenceIds = [],
    maxTargets
}) {
    const extraIds = (referenceIds || []).map((id) => String(id)).filter(Boolean);
    let variationById = await buildVariationByIdMapFromSetsAsync(familySets, extraIds);

    const referenceSourceIds = resolveChartSourceVariationIds(extraIds, variationById);
    const allLabelIds = [...new global.Set([...extraIds, ...referenceSourceIds])];
    if (allLabelIds.length > extraIds.length) {
        variationById = await buildVariationByIdMapFromSetsAsync(familySets, allLabelIds);
    }
    const referenceSignature = referenceSourceIds.length
        ? toSortedSignature(referenceSourceIds)
        : null;

    const signatureMeta = new Map();
    for (const setDoc of familySets || []) {
        const signature = resolveSetProgressionSignature(setDoc, variationById);
        if (!signature) continue;

        if (!signatureMeta.has(signature)) {
            const rawIds = getVariationIdsFromSetDoc(setDoc);
            signatureMeta.set(signature, {
                signature,
                count: 0,
                mergedNameFrCounts: new Map(),
                mergedNameEnCounts: new Map(),
                sourceVariationIds: resolveChartSourceVariationIds(rawIds, variationById),
            });
        }
        const row = signatureMeta.get(signature);
        row.count += 1;

        const mergedFr = typeof setDoc?.mergedVariationsNames?.fr === 'string'
            ? setDoc.mergedVariationsNames.fr.trim()
            : '';
        if (mergedFr) {
            row.mergedNameFrCounts.set(mergedFr, (row.mergedNameFrCounts.get(mergedFr) || 0) + 1);
        }
        const mergedEn = typeof setDoc?.mergedVariationsNames?.en === 'string'
            ? setDoc.mergedVariationsNames.en.trim()
            : '';
        if (mergedEn) {
            row.mergedNameEnCounts.set(mergedEn, (row.mergedNameEnCounts.get(mergedEn) || 0) + 1);
        }
    }

    const targets = [];
    for (const row of signatureMeta.values()) {
        const bestMergedFr = pickBestMergedVariationName(row.mergedNameFrCounts);
        const bestMergedEn = pickBestMergedVariationName(row.mergedNameEnCounts);
        const fallback = buildLocalizedLabelFromVariationIds(row.sourceVariationIds, variationById);
        const name = {
            fr: bestMergedFr?.fr || fallback.fr,
            en: bestMergedEn?.fr || fallback.en,
        };
        targets.push({
            signature: row.signature,
            name,
            count: row.count,
            isDirect: referenceSignature != null && row.signature === referenceSignature,
            sourceVariationIds: row.sourceVariationIds,
        });
    }

    if (referenceSignature && !targets.some((target) => target.signature === referenceSignature)) {
        const labelVariationIds = extraIds.length > 0
            ? extraIds
            : (referenceSignature.includes('|')
                ? referenceSignature.split('|').filter(Boolean)
                : [referenceSignature]);
        const fallback = buildComboLocalizedLabelFromVariationIds(labelVariationIds, variationById);
        targets.push({
            signature: referenceSignature,
            name: fallback,
            count: 0,
            isDirect: true,
            sourceVariationIds: referenceSourceIds,
        });
    }

    const ordered = targets.sort((a, b) => {
        if (referenceSignature) {
            if (a.signature === referenceSignature) return -1;
            if (b.signature === referenceSignature) return 1;
        }
        if (b.count !== a.count) return b.count - a.count;
        return String(a.name?.fr || '').localeCompare(String(b.name?.fr || ''));
    });

    const safeMax = Math.max(1, Math.min(200, Number(maxTargets) || 40));
    const totalDistinctTargets = ordered.length;
    let capped = false;
    let result = ordered;
    if (ordered.length > safeMax) {
        const refTarget = referenceSignature
            ? ordered.find((target) => target.signature === referenceSignature)
            : null;
        const others = ordered.filter((target) => target.signature !== referenceSignature);
        result = refTarget
            ? [refTarget, ...others.slice(0, safeMax - 1)]
            : ordered.slice(0, safeMax);
        capped = true;
    }

    const shouldLogSmithBench = extraIds.some(
        (id) => String(id) === SMITH_BENCH_GUIDED_VARIATION_ID,
    );
    if (shouldLogSmithBench) {
        const rawVariationCounts = new Map();
        const chartSignatureCounts = new Map();
        for (const setDoc of familySets || []) {
            const rawIds = getVariationIdsFromSetDoc(setDoc);
            const rawKey = toSortedSignature(rawIds);
            if (rawKey) {
                rawVariationCounts.set(rawKey, (rawVariationCounts.get(rawKey) || 0) + 1);
            }
            const chartSig = resolveSetProgressionSignature(setDoc, variationById);
            if (chartSig) {
                chartSignatureCounts.set(chartSig, (chartSignatureCounts.get(chartSig) || 0) + 1);
            }
        }
        console.debug('[Progression][SmithBenchSignatureMap]', {
            referenceIds: extraIds,
            referenceSourceIds,
            referenceSignature,
            targetSignatures: result.map((target) => ({
                signature: target.signature,
                name: target.name?.fr || target.name?.en || null,
                count: target.count,
                isDirect: target.isDirect === true,
            })),
            rawVariationCounts: Object.fromEntries(rawVariationCounts),
            chartSignatureCounts: Object.fromEntries(chartSignatureCounts),
            note: 'Sets loggés avec id solo 6922144c sont dépliés via equivalentTo → signature combo; la signature solo peut apparaître en family row mais pas en target PR.',
        });
    }

    return {
        targets: result,
        targetIds: result.map((target) => target.signature),
        referenceSignature,
        totalDistinctTargets,
        capped,
        maxTargetsApplied: safeMax,
        variationById,
    };
}

/** ObjectId targets for whichweight/value-figure (includes graph edge nodes when requested). */
async function collectTargetVariationIdsForFigureFamily({
    familySets,
    normalizedMainExerciseId,
    progressionGraphContextVariationId = null,
    referenceCanonicalId,
    includeAllGraphTargets,
    maxTargets
}) {
    const refStr = String(referenceCanonicalId);
    const idPool = new global.Set();
    idPool.add(refStr);
    if (normalizedMainExerciseId) idPool.add(String(normalizedMainExerciseId));

    for (const setDoc of familySets) {
        for (const id of getVariationIdsFromSetDoc(setDoc)) {
            idPool.add(String(id));
        }
    }

    const graphContextForEdges = (progressionGraphContextVariationId != null
        && mongoose.Types.ObjectId.isValid(String(progressionGraphContextVariationId)))
        ? String(progressionGraphContextVariationId)
        : normalizedMainExerciseId;

    let graphIds = [];
    if (includeAllGraphTargets) {
        graphIds = await collectGraphVariationNodeIdsForContext(graphContextForEdges);
        graphIds.forEach((id) => idPool.add(String(id)));
    }

    const variationDocs = await Variation.find(
        { _id: { $in: [...idPool].map((id) => new mongoose.Types.ObjectId(id)) } },
        { isExercice: 1, equivalentTo: 1, name: 1, possibleProgression: 1 }
    ).lean();

    const variationById = new Map(variationDocs.map((doc) => [String(doc._id), doc]));
    const equivalentToById = new Map(
        variationDocs.map((doc) => [String(doc._id), (doc.equivalentTo || []).map((x) => String(x))])
    );
    const mainEquivalentIds = normalizedMainExerciseId
        ? (equivalentToById.get(String(normalizedMainExerciseId)) || []).map((x) => String(x))
        : [];

    const allGroups = [
        [refStr],
        ...familySets.map((setDoc) => getVariationIdsFromSetDoc(setDoc))
    ].filter((g) => Array.isArray(g) && g.length > 0);
    const canonicalBySignature = await buildCanonicalVariationMap(allGroups);

    const targetSet = new global.Set();
    targetSet.add(refStr);

    for (const setDoc of familySets) {
        const sourceVariationIds = getVariationIdsFromSetDoc(setDoc);
        if (!sourceVariationIds.length) continue;
        const sig = toSortedSignature(sourceVariationIds);
        const sourceCanonicalVariationId = canonicalBySignature.get(sig) || sourceVariationIds[0];
        const sourceDetailVariationId = resolveDetailVariationIdFromEquivalentTo({
            sourceVariationIds,
            normalizedMainExerciseId,
            equivalentToById,
            variationById,
            mainExerciseIds: mainEquivalentIds
        });
        const candidate = sourceDetailVariationId || sourceCanonicalVariationId;
        if (candidate) targetSet.add(String(candidate));
    }

    if (includeAllGraphTargets) {
        for (const gid of graphIds) {
            targetSet.add(String(gid));
        }
    }

    const freq = new Map();
    for (const tid of targetSet) freq.set(tid, 0);
    for (const setDoc of familySets) {
        const idsOnSet = new global.Set(getVariationIdsFromSetDoc(setDoc));
        for (const tid of targetSet) {
            if (idsOnSet.has(tid)) {
                freq.set(tid, (freq.get(tid) || 0) + 1);
            }
        }
    }

    const progressionEnabledIds = new global.Set(
        variationDocs
            .filter((doc) => doc?.possibleProgression !== false)
            .map((doc) => String(doc._id))
    );
    const filteredTargets = [...targetSet].filter((id) => id === refStr || progressionEnabledIds.has(String(id)));

    const others = filteredTargets.filter((id) => id !== refStr).sort((a, b) => {
        const fa = freq.get(a) || 0;
        const fb = freq.get(b) || 0;
        if (fb !== fa) return fb - fa;
        const na = variationById.get(a)?.name?.fr || variationById.get(a)?.name?.en || '';
        const nb = variationById.get(b)?.name?.fr || variationById.get(b)?.name?.en || '';
        return String(na).localeCompare(String(nb));
    });

    const safeMax = Math.max(1, Math.min(200, Number(maxTargets) || 40));
    const totalDistinctTargets = filteredTargets.length;
    let ordered = [refStr, ...others];
    let capped = false;
    if (ordered.length > safeMax) {
        ordered = [refStr, ...others.slice(0, safeMax - 1)];
        capped = true;
    }

    return {
        targetIds: ordered,
        totalDistinctTargets,
        capped,
        maxTargetsApplied: safeMax
    };
}

async function resolveFigurePrNamesMap(variationIds) {
    const uniq = [...new global.Set((variationIds || []).map((id) => String(id)))];
    if (!uniq.length) return new Map();
    const docs = await Variation.find(
        { _id: { $in: uniq.map((id) => new mongoose.Types.ObjectId(id)) } },
        { name: 1 }
    ).lean();
    return new Map(
        docs.map((doc) => [String(doc._id), { fr: doc.name?.fr || null, en: doc.name?.en || null }])
    );
}

async function buildProgressionPrEntriesForSignatureTargets({
    rawSets,
    targets,
    referenceCanonicalId,
    normalizedMainExerciseId,
    exercice,
    userId,
    progressionGraphContextVariationId,
    variationById,
    computePrsFn,
}) {
    const adjacency = await buildAdjacencyList({ contextVariationId: progressionGraphContextVariationId });
    const entries = [];
    for (const target of targets || []) {
        const scopedSets = filterSetsByExactProgressionSignature(
            rawSets,
            target.signature,
            variationById
        );
        if (shouldUseCardioPrPath(scopedSets, target.signature, variationById)) {
            const cardioScopedSets = filterCardioSets(scopedSets);
            const scopedPoints = cardioScopedSets
                .map((set) => mapSetToCardioPoint(set, target.signature))
                .filter(Boolean)
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            const cardioPeak = computeCardioPeakFromPoints(scopedPoints, { weightUnit: 'kg' });
            const prsRaw = computeCardioPrsFromSets(cardioScopedSets);
            const cardioPeakWithLabel = {
                ...cardioPeak,
                sourceScope: 'signature',
                sourceVariationSignature: target.signature,
                sourceVariationLabel: target.name && typeof target.name === 'object'
                    ? { fr: target.name.fr || null, en: target.name.en || null }
                    : null,
            };
            const prs = enrichCardioPrSlotsWithPeakDiff(prsRaw, cardioPeakWithLabel?.referenceDistanceKm);
            entries.push({
                variationId: target.signature,
                variationSignature: target.signature,
                isDirect: target.isDirect === true,
                name: target.name,
                isCardio: true,
                strengthPeak: cardioPeakWithLabel,
                cardioPeak: cardioPeakWithLabel,
                prs,
            });
            continue;
        }
        const isDirectEntry = target.isDirect === true;
        const mainForAugment = isDirectEntry && exercice != null && String(exercice) !== ''
            ? exercice
            : normalizedMainExerciseId;
        const augmented = await augmentSetsWithNormalizedMetrics({
            sets: scopedSets,
            userId,
            referenceVariations: referenceCanonicalId,
            mainExerciseId: mainForAugment,
            adjacencyPrebuilt: adjacency
        });
        const scopedPoints = augmented
            .map((set) => mapAugmentedSetToFigurePoint(set, target.signature))
            .filter(Boolean)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const strengthPeak = computeStrengthPeakFromFigurePoints(scopedPoints, {
            debugContext: {
                mainExerciseId: normalizedMainExerciseId,
                variationSignature: target.signature,
            },
        });
        const prsRaw = computePrsFn(augmented);
        const strengthPeakWithLabel = {
            ...strengthPeak,
            sourceScope: 'signature',
            sourceVariationSignature: target.signature,
            sourceVariationLabel: target.name && typeof target.name === 'object'
                ? { fr: target.name.fr || null, en: target.name.en || null }
                : null,
        };
        const prs = enrichPrSlotsWithPeakForceDiff(prsRaw, strengthPeakWithLabel?.referenceKg);
        logHistoricalSetCountDiagnostics(target, {
            scopedSets,
            augmented,
            prs,
        });
        entries.push({
            variationId: target.signature,
            variationSignature: target.signature,
            isDirect: isDirectEntry,
            name: target.name,
            strengthPeak: strengthPeakWithLabel,
            prs
        });
    }
    return entries;
}

async function resolveProgressionFamilyScopedRawSetsForPrs({
    userId,
    excludedSeanceId = null,
    exercice = null,
    categories = null,
    dateMin = null,
    referenceIds,
    normalizedMainExerciseId,
    normalizedLateralMode,
    familyKey = null,
    includedVariationIds = null,
    excludedVariationSignatures = null,
    logMode = null,
}) {
    let rawSets = await fetchSetsForPR(
        userId,
        excludedSeanceId,
        exercice,
        categories,
        dateMin,
        null,
        undefined,
    );
    rawSets = await filterProgressionFamilySetsForPrs({
        rawSets,
        normalizedMainExerciseId,
        normalizedLateralMode,
        includedVariationIds,
        excludedVariationSignatures,
    });
    const familyScope = await resolveFamilyScopeSignaturesForTimeseries({
        userId,
        referenceVariationIds: referenceIds,
        dateMin,
        lateralMode: normalizedLateralMode,
        familyKey,
    });
    const familyScopeSignatures = familyScope?.signatures || null;
    if (familyScopeSignatures && familyScopeSignatures.size > 0) {
        const variationByIdForScope = await buildVariationByIdMapFromSetsAsync(rawSets, referenceIds);
        rawSets = (rawSets || []).filter((setDoc) => {
            const signature = resolveSetProgressionSignature(setDoc, variationByIdForScope);
            return signature ? familyScopeSignatures.has(signature) : false;
        });
    }
    if (logMode) {
        console.debug('[Progression][PRScope]', {
            mode: logMode,
            userId: String(userId || ''),
            mainExerciseId: normalizedMainExerciseId,
            referenceVariationIds: referenceIds,
            familyScope: familyScope?.debug || null,
            filteredSetsCount: Array.isArray(rawSets) ? rawSets.length : 0,
        });
    }
    return { rawSets, familyScope };
}

async function getProgressionPRs({
    userId,
    excludedSeanceId = null,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    lateralMode = 'bilateral',
    includedVariationIds = null,
    excludedVariationSignatures = null,
    referenceVariations,
    mainExerciseId,
    familyKey = null,
    includeAllGraphTargets = false,
    maxTargets = 40
}) {
    const normalizedLateralMode = normalizeLateralMode(lateralMode);
    const referenceIds = await resolveReferenceVariationIdsForProgression({
        referenceVariations,
        mainExerciseId
    });
    const referenceCanonicalId = await resolveCanonicalVariationIdFromIds(referenceIds);
    if (!referenceCanonicalId) {
        throw new Error('referenceVariations est requis');
    }

    let normalizedMainExerciseId = mongoose.Types.ObjectId.isValid(mainExerciseId)
        ? String(mainExerciseId)
        : null;
    if (!normalizedMainExerciseId) {
        throw new Error('mainExerciseId est requis');
    }
    normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    const progressionGraphContextVariationId = await resolveGraphContextVariationId(normalizedMainExerciseId);

    const { rawSets, familyScope } = await resolveProgressionFamilyScopedRawSetsForPrs({
        userId,
        excludedSeanceId,
        exercice,
        categories,
        dateMin,
        referenceIds,
        normalizedMainExerciseId,
        normalizedLateralMode,
        familyKey,
        includedVariationIds,
        excludedVariationSignatures,
        logMode: 'prs',
    });

    const {
        targets,
        totalDistinctTargets,
        capped,
        maxTargetsApplied,
        variationById,
        referenceSignature,
    } = await collectTargetSignaturesForProgressionFamily({
        familySets: rawSets,
        referenceIds,
        maxTargets
    });

    const entries = await buildProgressionPrEntriesForSignatureTargets({
        rawSets,
        targets,
        referenceCanonicalId,
        normalizedMainExerciseId,
        exercice,
        userId,
        progressionGraphContextVariationId,
        variationById,
        computePrsFn: computePrsFromAugmentedSets,
    });

    return {
        mainExerciseId: normalizedMainExerciseId,
        progressionGraphContextVariationId,
        referenceVariationId: String(referenceCanonicalId),
        referenceVariationSignature: referenceSignature,
        entries,
        meta: {
            familySetCount: rawSets.length,
            totalDistinctTargets,
            returnedTargets: entries.length,
            maxTargets: maxTargetsApplied,
            capped,
            includeAllGraphTargets: Boolean(includeAllGraphTargets),
            lateralMode: normalizedLateralMode,
            referenceVariationSignature: referenceSignature,
            familyScopeDebug: familyScope?.debug || null,
        }
    };
}

const getFigurePRs = getProgressionPRs;

async function getProgressionDetailedPRs({
    userId,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    lateralMode = 'bilateral',
    includedVariationIds = null,
    excludedVariationSignatures = null,
    referenceVariations,
    mainExerciseId,
    familyKey = null,
    includeAllGraphTargets = false,
    maxTargets = 40
}) {
    const normalizedLateralMode = normalizeLateralMode(lateralMode);
    const referenceIds = await resolveReferenceVariationIdsForProgression({
        referenceVariations,
        mainExerciseId
    });
    const referenceCanonicalId = await resolveCanonicalVariationIdFromIds(referenceIds);
    if (!referenceCanonicalId) {
        throw new Error('referenceVariations est requis');
    }

    let normalizedMainExerciseId = mongoose.Types.ObjectId.isValid(mainExerciseId)
        ? String(mainExerciseId)
        : null;
    if (!normalizedMainExerciseId) {
        throw new Error('mainExerciseId est requis');
    }
    normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    const progressionGraphContextVariationId = await resolveGraphContextVariationId(normalizedMainExerciseId);

    const { rawSets, familyScope } = await resolveProgressionFamilyScopedRawSetsForPrs({
        userId,
        exercice,
        categories,
        dateMin,
        referenceIds,
        normalizedMainExerciseId,
        normalizedLateralMode,
        familyKey,
        includedVariationIds,
        excludedVariationSignatures,
        logMode: 'detailed-prs',
    });

    const {
        targets,
        totalDistinctTargets,
        capped,
        maxTargetsApplied,
        variationById,
        referenceSignature,
    } = await collectTargetSignaturesForProgressionFamily({
        familySets: rawSets,
        referenceIds,
        maxTargets
    });

    const entries = await buildProgressionPrEntriesForSignatureTargets({
        rawSets,
        targets,
        referenceCanonicalId,
        normalizedMainExerciseId,
        exercice,
        userId,
        progressionGraphContextVariationId,
        variationById,
        computePrsFn: computeDetailedPrsFromAugmentedSets,
    });

    return {
        mainExerciseId: normalizedMainExerciseId,
        progressionGraphContextVariationId,
        referenceVariationId: String(referenceCanonicalId),
        referenceVariationSignature: referenceSignature,
        entries,
        meta: {
            familySetCount: rawSets.length,
            totalDistinctTargets,
            returnedTargets: entries.length,
            maxTargets: maxTargetsApplied,
            capped,
            includeAllGraphTargets: Boolean(includeAllGraphTargets),
            lateralMode: normalizedLateralMode,
            referenceVariationSignature: referenceSignature,
            familyScopeDebug: familyScope?.debug || null,
        }
    };
}

/**
 * Detailed PR rows for whichweight/value-figure: family targets by signature (same as progression PRs)
 * plus optional graph edge ObjectId targets without performed signature rows.
 */
async function getFigureDetailedPRs({
    userId,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    lateralMode = 'bilateral',
    referenceVariations,
    mainExerciseId,
    familyKey = null,
    includeAllGraphTargets = false,
    expandGenericTargets = true,
    maxTargets = 40
}) {
    const referenceIds = await resolveReferenceVariationIdsForProgression({
        referenceVariations,
        mainExerciseId
    });
    const referenceCanonicalId = await resolveCanonicalVariationIdFromIds(referenceIds);
    if (!referenceCanonicalId) {
        throw new Error('referenceVariations est requis');
    }

    let normalizedMainExerciseId = mongoose.Types.ObjectId.isValid(mainExerciseId)
        ? String(mainExerciseId)
        : null;
    if (!normalizedMainExerciseId) {
        throw new Error('mainExerciseId est requis');
    }
    normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    const progressionGraphContextVariationId = await resolveGraphContextVariationId(normalizedMainExerciseId);
    const normalizedLateralMode = normalizeLateralMode(lateralMode);

    const allowlist = await resolveFigureRecommendationAllowlist({
        userId,
        referenceVariations,
        mainExerciseId,
        familyKey,
        dateMin,
        lateralMode: normalizedLateralMode,
        includeAllGraphTargets,
        expandGenericTargets,
        maxTargets,
    });

    const { rawSets, familyScope } = await resolveProgressionFamilyScopedRawSetsForPrs({
        userId,
        exercice,
        categories,
        dateMin,
        referenceIds,
        normalizedMainExerciseId,
        normalizedLateralMode,
        familyKey,
        logMode: 'figure-detailed-prs',
    });

    const {
        targets,
        totalDistinctTargets,
        capped,
        maxTargetsApplied,
        variationById,
        referenceSignature,
    } = await collectTargetSignaturesForProgressionFamily({
        familySets: rawSets,
        referenceIds,
        maxTargets,
    });

    const familyEntries = await buildProgressionPrEntriesForSignatureTargets({
        rawSets,
        targets,
        referenceCanonicalId,
        normalizedMainExerciseId,
        exercice,
        userId,
        progressionGraphContextVariationId,
        variationById,
        computePrsFn: computeDetailedPrsFromAugmentedSets,
    });

    const entries = [...familyEntries];
    const coveredTargetKeys = new global.Set(
        familyEntries.map((entry) => String(entry.variationSignature || entry.variationId)),
    );

    const edgeVariationIds = [...allowlist.edgeVariationIds]
        .map((id) => String(id))
        .filter((id) => id && !coveredTargetKeys.has(id));

    if (includeAllGraphTargets && isFrontLeverFigureGraphDebugFocus(mainExerciseId, referenceIds)) {
        const graphContextId = progressionGraphContextVariationId
            || await resolveGraphContextVariationId(normalizedMainExerciseId);
        const fullGraphNodeIds = graphContextId
            ? await collectGraphVariationNodeIdsForContext(graphContextId)
            : [];
        const missingGraphNodesNotInAllowlist = fullGraphNodeIds.filter(
            (id) => !allowlist.variationIds.has(String(id)) && !coveredTargetKeys.has(String(id)),
        );
        console.debug('[Progression][FigureDetailedPrs][EdgeBuild]', {
            referenceVariationId: String(referenceCanonicalId),
            graphContextId,
            familySignatureTargetCount: familyEntries.length,
            coveredTargetKeys: [...coveredTargetKeys],
            allowlistEdgeIds: [...allowlist.edgeVariationIds],
            edgeVariationIdsToBuild: edgeVariationIds,
            fullGraphNodeCount: fullGraphNodeIds.length,
            missingGraphNodesNotInAllowlistCount: missingGraphNodesNotInAllowlist.length,
            sampleMissingGraphNodes: missingGraphNodesNotInAllowlist.slice(0, 15),
            note: 'edgeVariationIds = allowlist graphe (full_graph ou 1-hop selon expandGenericTargets), matérialisés en entrées ObjectId.',
        });
    }

    if (edgeVariationIds.length > 0) {
        const fetchUnilateralSide = normalizedLateralMode === 'left'
            ? 'left'
            : normalizedLateralMode === 'right'
                ? 'right'
                : undefined;
        const adjacency = await buildAdjacencyList({ contextVariationId: progressionGraphContextVariationId });
        const namesMap = await resolveFigurePrNamesMap(edgeVariationIds);
        const edgeDocs = await Variation.find(
            { _id: { $in: edgeVariationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
            { isExercice: 1 },
        ).lean();
        const targetIsExerciseById = new Map(
            edgeDocs.map((doc) => [String(doc._id), doc?.isExercice === true]),
        );

        for (const variationId of edgeVariationIds) {
            const isDirectEntry = String(variationId) === String(referenceCanonicalId);
            const targetIsExercise = targetIsExerciseById.get(String(variationId)) === true;
            const variationFilterInput = targetIsExercise
                ? variationId
                : [normalizedMainExerciseId, variationId];
            const variationMatchMode = targetIsExercise ? 'exact' : 'contains';
            const setsForAugment = filterSetsByLateralMode(
                await fetchSetsForPR(
                    userId,
                    null,
                    exercice,
                    categories,
                    dateMin,
                    variationFilterInput,
                    fetchUnilateralSide,
                    variationMatchMode,
                ),
                normalizedLateralMode,
            );
            const mainForAugment = isDirectEntry && exercice != null && String(exercice) !== ''
                ? exercice
                : normalizedMainExerciseId;
            const augmented = await augmentSetsWithNormalizedMetrics({
                sets: setsForAugment,
                userId,
                referenceVariations: variationId,
                mainExerciseId: mainForAugment,
                adjacencyPrebuilt: adjacency,
            });
            entries.push({
                variationId: String(variationId),
                isDirect: isDirectEntry,
                isTargetExercise: targetIsExercise,
                isEdgeTarget: true,
                name: namesMap.get(String(variationId)) || null,
                prs: computeDetailedPrsFromAugmentedSets(augmented),
            });
        }
    }

    const totalReturnedTargets = entries.length;
    const totalDistinctFigureTargets = totalDistinctTargets + edgeVariationIds.length;

    return {
        mainExerciseId: normalizedMainExerciseId,
        progressionGraphContextVariationId,
        referenceVariationId: String(referenceCanonicalId),
        referenceVariationSignature: referenceSignature,
        entries,
        allowlist,
        meta: {
            familySetCount: rawSets.length,
            totalDistinctTargets: totalDistinctFigureTargets,
            returnedTargets: totalReturnedTargets,
            maxTargets: maxTargetsApplied,
            capped,
            includeAllGraphTargets: Boolean(includeAllGraphTargets),
            lateralMode: normalizedLateralMode,
            referenceVariationSignature: referenceSignature,
            familyScopeDebug: {
                ...(allowlist.familyScopeDebug || {}),
                ...(familyScope?.debug || {}),
            },
        }
    };
}

/**
 * Get a summary of personal records for a user's favorite exercices.
 * @param {string} userId - The ID of the user.
 * @param {number} page - The page number for favorite exercices (default: 1).
 * @param {number} limit - The number of favorite exercices to retrieve (default: 10).
 * @param {string} dateMin - The minimum date for PR consideration (optional).
 * @returns {Promise<Object>} - An object containing favorite exercices with their best PRs.
 * {
  summaries: [
    {
      variations: [...],      // Array of variation documents
      variationIds: [...],    // Array of variation IDs
      usageCount: 42,         // Number of times used
      prs: {
        Puissance: { repetitions: {...}, seconds: {...} },
        Force: { repetitions: {...}, seconds: {...} },
        Volume: { repetitions: {...}, seconds: {...} },
        Endurance: { repetitions: {...}, seconds: {...} },
        Best: {...}           // Overall best PR with category & unit
      },
      totalSets: 156          // Total sets recorded for this combination
    }
  ],
  total: 50,                  // Total favorite exercices
  page: 1,
  limit: 10
}
 */
async function getPersonalRecordsSummary(userId, page = 1, limit = 10, dateMin = null) {
    try {
        const { variations: favoriteExercices, total } = await getMyExercicesAll(userId, page, limit);

        // Step 2: For each variation combination, find the best PR
        const summaries = await Promise.all(
            favoriteExercices.map(async (exercice) => {
                const variationIds = exercice._id; // Array of variation IDs
                const count = exercice.count; // Number of times this combination was used

                // Build query for sets with these specific variations
                const query = {
                    value: { $gt: 0 },
                    user: new mongoose.Types.ObjectId(userId)
                };

                // Match exact variation combination
                if (variationIds?.length) {
                    const variationGroups = await getAlternativeVariationGroups(variationIds);
                    const variationQuery = buildVariationsExactMatchQuery(variationGroups);

                    if (variationQuery?.$or) {
                        query.$or = variationQuery.$or;
                    } else if (variationQuery?.variations) {
                        query.variations = variationQuery.variations;
                    }
                }

                // Apply date filter if provided
                if (dateMin) {
                    query.date = { $gte: new Date(dateMin) };
                }

                // Fetch sets sorted by date
                const sets = await Set.find(query).sort({ date: 1 }).exec();

                // Initialize PR categories
                const prs = {
                    Puissance: { repetitions: null, seconds: null },
                    Force: { repetitions: null, seconds: null },
                    Volume: { repetitions: null, seconds: null },
                    Endurance: { repetitions: null, seconds: null },
                    ATH: { repetitions: null, seconds: null },
                    Best: null // Overall best across all categories
                };

                // Process each set to find PRs
                for (const set of sets) {
                    const categoriesForSet = classifySet(set.unit, set.value);
                    for (const category of categoriesForSet) {
                        if (prs[category]) {
                            prs[category][set.unit] = compareAndAssignPR(prs[category][set.unit], set);
                        }
                    }
                    if (set?.unit && prs.ATH[set.unit] !== undefined) {
                        prs.ATH[set.unit] = compareAndAssignPR(prs.ATH[set.unit], set);
                    }
                }

                // Find overall best PR (prefer ATH, then category order)
                let overallBest = null;
                let maxScore = -1;

                let idx = 0;
                for (const category of ['ATH', 'Endurance', 'Volume', 'Force', 'Puissance']) {
                    for (const unit of ['seconds', 'repetitions']) {
                        const pr = prs[category][unit];
                        if (pr) {
                            const score = idx;
                            if (score > maxScore) {
                                maxScore = score;
                                overallBest = { ...pr, category, unit };
                            }
                        }
                        idx++;
                    }
                }

                prs.Best = overallBest;

                return {
                    variations: exercice.variations, // Variation documents
                    variationIds: variationIds, // Array of variation IDs
                    usageCount: count, // Number of times used
                    prs: prs, // PRs by category plus overall best
                    totalSets: sets.length // Total number of sets recorded
                };
            })
        );

        return {
            summaries,
            total,
            page,
            limit
        };
    } catch (err) {
        console.error("Error fetching personal records summary:", err);
        throw err;
    }
}

/**
 * Check if a set is a personal record
 * @param {string} userId id of the user
 * @param {string} seanceId id of the seance
 * @param {string} unit unit of the set
 * @param {number} value value of the set
 * @param {number} weightLoad weightLoad of the set
 * @param {object} elastic elastic object with the following structure: {use, tension}
 * @param {list} variations writen as [{variation: "id"}]
 * @param {number|undefined|null} effectiveWeightLoadOverride — charge effective (kg) envoyée par l’app ; si défini et fini, utilisé à la place de weightLoad + élastique
 * @returns {string} "PR" | "SB" | "NB" | "ATH" | null — PR = plus lourd à reps égales ou plus de reps/sec à charge égale
 */
async function isPersonalRecord(
    userId,
    seanceId,
    unit,
    value,
    weightLoad,
    elastic,
    variations,
    effectiveWeightLoadOverride,
    isUnilateral = undefined,
    unilateralSide = undefined
) {
    const { isPersonalRecord } = await evaluatePersonalRecordWithContext(
        userId,
        seanceId,
        unit,
        value,
        weightLoad,
        elastic,
        variations,
        effectiveWeightLoadOverride,
        isUnilateral,
        unilateralSide
    );
    return isPersonalRecord;
};

function extractVariationIdsForPr(variations) {
    return (Array.isArray(variations) ? variations : [variations])
        .map((v) => (typeof v === 'object' && v !== null && v.variation != null
            ? String(v.variation)
            : (v != null ? String(v) : null)))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
}

function hasPersistedBodyweightOneRmFields(setLike) {
    if (setLike?.oneRepMaxIncludesBodyweight !== true) return false;
    const brzycki = setLike.brzyckiWithBodyweight;
    const epley = setLike.epleyWithBodyweight;
    const brzyckiOk = brzycki != null && brzycki !== '' && Number.isFinite(Number(brzycki)) && Number(brzycki) > 0;
    const epleyOk = epley != null && epley !== '' && Number.isFinite(Number(epley)) && Number(epley) > 0;
    return brzyckiOk || epleyOk;
}

/** Logs isPr / ATH : DEBUG_PR_ISPR=1 ou hors production (DEBUG_PR_ISPR=0 pour couper). */
function isPrDebugLoggingEnabled() {
    if (process.env.DEBUG_PR_ISPR === '0' || process.env.DEBUG_PR_ISPR === 'false') {
        return false;
    }
    return process.env.DEBUG_PR_ISPR === '1'
        || process.env.DEBUG_PR_ISPR === 'true'
        || process.env.NODE_ENV !== 'production';
}

function logPrEval(step, payload = {}) {
    if (!isPrDebugLoggingEnabled()) return;
    console.log('[PR/isPr]', step, JSON.stringify(payload));
}

function summarizeSetForPrLog(setLike) {
    if (!setLike) return null;
    const oneRm = resolvePrComparisonOneRmKg(setLike);
    return {
        unit: setLike.unit,
        value: setLike.value,
        weightLoad: setLike.weightLoad,
        effectiveWeightLoad: setLike.effectiveWeightLoad,
        oneRmKg: oneRm != null ? round2(oneRm) : null,
        includesBodyweight: setLike.oneRepMaxIncludesBodyweight === true,
        persistedBodyweightFields: hasPersistedBodyweightOneRmFields(setLike),
        userWeightKg: setLike.oneRepMaxUserWeightKg ?? null,
        bodyWeightRatio: setLike.oneRepMaxExerciseBodyWeightRatio ?? null,
        brzyckiBw: setLike.brzyckiWithBodyweight ?? null,
        epleyBw: setLike.epleyWithBodyweight ?? null,
    };
}

/**
 * Contexte PDC + mesures utilisateur pour enrichir les sets isPr (séance en cours, 0 kg externe).
 */
async function loadPrBodyweightEnrichmentContext(userId, variations) {
    const variationIds = extractVariationIdsForPr(variations);
    if (!userId || !variationIds.length) {
        return { includeBodyweight: false, userMeasures: [], weightedBodyweightKg: 0, exerciseBodyWeightRatio: 1 };
    }

    const variationDocs = await Variation.find(
        { _id: { $in: variationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
        { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 },
    ).lean();
    const variationById = new Map(variationDocs.map((doc) => [String(doc._id), doc]));
    const { includeBodyweight, exerciseBodyWeightRatio } = resolveSourceBodyweightPolicy(
        variationIds,
        variationIds,
        variationById,
    );
    if (!includeBodyweight) {
        logPrEval('bwContext', { includeBodyweight: false, variationIds });
        return { includeBodyweight: false, userMeasures: [], weightedBodyweightKg: 0, exerciseBodyWeightRatio: 1 };
    }

    const userMeasures = await UserMeasure.find(
        { userId: new mongoose.Types.ObjectId(userId) },
        { measuredAt: 1, 'weight.kg': 1 },
    ).sort({ measuredAt: 1 }).lean();

    logPrEval('bwContext', {
        includeBodyweight: true,
        variationIds,
        exerciseBodyWeightRatio,
        userMeasuresCount: userMeasures.length,
        latestUserWeightKg: userMeasures.length
            ? userMeasures[userMeasures.length - 1]?.weight?.kg
            : null,
    });

    return {
        includeBodyweight: true,
        userMeasures,
        exerciseBodyWeightRatio,
        weightedBodyweightKg: 0,
    };
}

/** 1RM estimé pour une perf PDC à un poids utilisateur donné (comparaison ATH / poids corps). */
function computeOneRmAtUserBodyweight(setLike, userWeightKg, exerciseBodyWeightRatio) {
    if (!setLike || !Number.isFinite(Number(userWeightKg)) || Number(userWeightKg) <= 0) {
        return null;
    }
    const ratio = Number.isFinite(Number(exerciseBodyWeightRatio)) && Number(exerciseBodyWeightRatio) > 0
        ? Number(exerciseBodyWeightRatio)
        : 1;
    const weighted = round2(Number(userWeightKg) * ratio);
    const externalLoad = getEffectiveLoadKg(setLike, { includeBodyweight: false });
    const totalLoad = round2(externalLoad + weighted);
    const estimates = computeSetOneRepMaxEstimates({
        unit: setLike.unit,
        value: setLike.value,
        weightLoad: totalLoad,
        effectiveWeightLoad: totalLoad,
        elastic: null,
    });
    return resolvePrComparisonOneRmKg({
        unit: setLike.unit,
        value: setLike.value,
        weightLoad: setLike.weightLoad,
        elastic: setLike.elastic,
        effectiveWeightLoad: externalLoad,
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: round2(userWeightKg),
        oneRepMaxExerciseBodyWeightRatio: ratio,
        brzyckiWithBodyweight: estimates.brzycki,
        epleyWithBodyweight: estimates.epley,
        repsEquivalent: setLike.value,
    });
}

function findPeakOneRmReferenceSet(sets, targetOneRmKg) {
    if (!Array.isArray(sets) || sets.length === 0 || targetOneRmKg == null) {
        return null;
    }
    let bestMatch = null;
    let bestOneRm = null;
    for (const set of sets) {
        const oneRm = resolvePrComparisonOneRmKg(set);
        if (oneRm == null) continue;
        if (Math.abs(oneRm - targetOneRmKg) <= 0.05) {
            return set;
        }
        if (bestOneRm == null || oneRm > bestOneRm) {
            bestOneRm = oneRm;
            bestMatch = set;
        }
    }
    return bestMatch;
}

/**
 * ATH expliqué par le poids corps.
 * Même reps (ou plus) : le 1RM recalculé au poids du pic ne doit pas déjà battre le pic global.
 * Moins de reps que le pic : le pic est sur un autre schéma — note PDC si charge externe identique.
 * @returns {{ athDriver: 'bodyweight', referencePeakUserWeightKg: number, currentUserWeightKg: number }|null}
 */
function resolveAthBodyweightDriver({
    bwContext,
    currentSetForOneRm,
    currentOneRm,
    maxReferenceOneRm,
    setsForAthPeak,
    value,
    currentEffectiveLoad,
}) {
    if (!bwContext?.includeBodyweight || currentOneRm == null || maxReferenceOneRm == null) {
        return null;
    }
    if (currentOneRm <= maxReferenceOneRm + LOAD_EPSILON) {
        return null;
    }

    const peakSet = findPeakOneRmReferenceSet(setsForAthPeak, maxReferenceOneRm);
    if (!peakSet) return null;

    const peakExternalLoad = getEffectiveLoadPreferringPersisted(peakSet);
    if (Math.abs(peakExternalLoad - currentEffectiveLoad) > LOAD_EPSILON) {
        return null;
    }

    const peakValue = Number(peakSet.value);
    const currentValue = Number(value);
    const fewerRepsThanPeak = Number.isFinite(peakValue) && Number.isFinite(currentValue)
        && currentValue < peakValue;

    let peakUserWeightKg = Number(peakSet.oneRepMaxUserWeightKg);
    if (!Number.isFinite(peakUserWeightKg) || peakUserWeightKg <= 0) {
        const peakDate = peakSet?.date ? new Date(peakSet.date) : new Date();
        peakUserWeightKg = resolveUserWeightKgForDate(bwContext.userMeasures, peakDate);
    }
    const currentUserWeightKg = Number(currentSetForOneRm.oneRepMaxUserWeightKg);
    if (!Number.isFinite(peakUserWeightKg) || peakUserWeightKg <= 0
        || !Number.isFinite(currentUserWeightKg) || currentUserWeightKg <= 0) {
        return null;
    }
    if (Math.abs(peakUserWeightKg - currentUserWeightKg) <= LOAD_EPSILON) {
        return null;
    }

    const ratio = Number.isFinite(Number(currentSetForOneRm.oneRepMaxExerciseBodyWeightRatio))
        ? Number(currentSetForOneRm.oneRepMaxExerciseBodyWeightRatio)
        : bwContext.exerciseBodyWeightRatio;

    const oneRmAtPeakUserWeight = computeOneRmAtUserBodyweight(
        currentSetForOneRm,
        peakUserWeightKg,
        ratio,
    );
    if (oneRmAtPeakUserWeight == null) {
        return null;
    }
    if (!fewerRepsThanPeak && oneRmAtPeakUserWeight > maxReferenceOneRm + LOAD_EPSILON) {
        return null;
    }

    return {
        athDriver: 'bodyweight',
        referencePeakUserWeightKg: round2(peakUserWeightKg),
        currentUserWeightKg: round2(currentUserWeightKg),
    };
}

function applyPrBodyweightEnrichment(setLike, bwContext, referenceDate = new Date(), logLabel = null) {
    if (!setLike || !bwContext?.includeBodyweight) {
        if (logLabel) {
            logPrEval('bwEnrichSkip', {
                label: logLabel,
                reason: !setLike ? 'noSet' : 'includeBodyweightFalse',
                includeBodyweight: bwContext?.includeBodyweight ?? false,
            });
        }
        return setLike;
    }
    if (hasPersistedBodyweightOneRmFields(setLike)) {
        if (logLabel) {
            logPrEval('bwEnrichSkip', {
                label: logLabel,
                reason: 'persistedBodyweightFields',
                snapshot: summarizeSetForPrLog(setLike),
            });
        }
        return setLike;
    }

    const userWeightKg = resolveUserWeightKgForDate(bwContext.userMeasures, referenceDate);
    if (!Number.isFinite(userWeightKg) || userWeightKg <= 0) {
        if (logLabel) {
            logPrEval('bwEnrichSkip', {
                label: logLabel,
                reason: 'noUserWeightForDate',
                referenceDate: referenceDate?.toISOString?.() ?? referenceDate,
            });
        }
        return setLike;
    }

    const ratio = Number.isFinite(Number(bwContext.exerciseBodyWeightRatio))
        && Number(bwContext.exerciseBodyWeightRatio) > 0
        ? Number(bwContext.exerciseBodyWeightRatio)
        : 1;
    const weighted = userWeightKg * ratio;
    const externalLoad = getEffectiveLoadKg(setLike, { includeBodyweight: false });
    const effectiveWeightLoadWithBodyweight = round2(externalLoad + weighted);
    const withBw = computeSetOneRepMaxEstimates({
        ...setLike,
        weightLoad: effectiveWeightLoadWithBodyweight,
        effectiveWeightLoad: effectiveWeightLoadWithBodyweight,
        elastic: null,
    });
    const brzyckiWithBodyweight = withBw.brzycki;
    const epleyWithBodyweight = withBw.epley;

    const enriched = {
        ...setLike,
        effectiveWeightLoad: setLike.effectiveWeightLoad != null
            ? setLike.effectiveWeightLoad
            : round2(externalLoad),
        effectiveWeightLoadWithBodyweight,
        brzyckiWithBodyweight,
        epleyWithBodyweight,
        brzycki: brzyckiWithBodyweight != null
            ? round2(brzyckiWithBodyweight - weighted)
            : (setLike.brzycki ?? null),
        epley: epleyWithBodyweight != null
            ? round2(epleyWithBodyweight - weighted)
            : (setLike.epley ?? null),
        oneRepMaxIncludesBodyweight: true,
        oneRepMaxUserWeightKg: round2(userWeightKg),
        oneRepMaxExerciseBodyWeightRatio: ratio,
    };
    if (logLabel) {
        logPrEval('bwEnrichApplied', {
            label: logLabel,
            snapshot: summarizeSetForPrLog(enriched),
        });
    }
    return enriched;
}

async function fetchPersonalRecordCandidateSets(
    userId,
    seanceId,
    unit,
    variations,
    isUnilateral = undefined,
    unilateralSide = undefined
) {
    const query = {};
    if (userId) {
        query.user = new mongoose.Types.ObjectId(userId);
    }
    if (seanceId) {
        query.seance = { $ne: new mongoose.Types.ObjectId(seanceId) };
    }
    if (unit) {
        query.unit = unit;
    }
    if (variations) {
        const variationIds = (Array.isArray(variations) ? variations : [variations]).map(v =>
            typeof v === 'object' && v !== null ? v.variation?.toString() : v?.toString()
        ).filter(Boolean);
        const variationGroups = await getAlternativeVariationGroups(variationIds);
        const variationQuery = buildVariationsExactMatchQuery(variationGroups);
        if (variationQuery?.$or) {
            query.$or = variationQuery.$or;
        } else if (variationQuery?.variations) {
            query.variations = variationQuery.variations;
        }
    }
    if (isUnilateral !== undefined) {
        query.isUnilateral = isUnilateral;
    }
    if (unilateralSide !== undefined) {
        query.unilateralSide = unilateralSide;
    }

    return Set.find(query)
        .select([
            'unit value weightLoad elastic effectiveWeightLoad weightLoadLbs effectiveWeightLoadLbs',
            'cardio',
            'brzycki epley brzyckiWithBodyweight epleyWithBodyweight',
            'oneRepMaxIncludesBodyweight oneRepMaxUserWeightKg oneRepMaxExerciseBodyWeightRatio',
            'effectiveWeightLoadWithBodyweight date seance variations',
        ].join(' '))
        .lean()
        .exec();
}

async function evaluatePersonalRecordWithContext(
    userId,
    seanceId,
    unit,
    value,
    weightLoad,
    elastic,
    variations,
    effectiveWeightLoadOverride,
    isUnilateral = undefined,
    unilateralSide = undefined,
    sessionSets = undefined,
    excludeSetId = undefined,
    cardio = undefined,
) {

    if (unit === 'cardio') {
        if (value === 0) {
            return { isPersonalRecord: null, prDetail: null };
        }
        const historicalSets = await fetchPersonalRecordCandidateSets(
            userId,
            seanceId,
            unit,
            variations,
            isUnilateral,
            unilateralSide,
        );
        const sessionPeerSets = normalizeSessionSetsForPrEvaluation(sessionSets, {
            excludeSetId,
            unit,
            isUnilateral,
            unilateralSide,
        });
        return evaluateCardioPersonalRecord(
            { unit, value, cardio },
            historicalSets,
            sessionPeerSets,
        );
    }

    if (value === 0) {
        return { isPersonalRecord: null, prDetail: null }; // Ignore sets with 0 reps
    }
    const currentEffectiveLoad =
        effectiveWeightLoadOverride !== undefined &&
            effectiveWeightLoadOverride !== null &&
            Number.isFinite(Number(effectiveWeightLoadOverride))
            ? Number(effectiveWeightLoadOverride)
            : getEffectiveLoad({ weightLoad, elastic });
    const currentEffectiveLoadLbs = round2(currentEffectiveLoad * KG_TO_LB);

    try {
        logPrEval('request', {
            userId: userId ? String(userId) : null,
            seanceId: seanceId ? String(seanceId) : null,
            unit,
            value,
            weightLoad,
            effectiveLoad: round2(currentEffectiveLoad),
            isUnilateral,
            unilateralSide,
            excludeSetId: excludeSetId != null ? String(excludeSetId) : null,
            sessionPeerCount: Array.isArray(sessionSets) ? sessionSets.length : 0,
        });

        const bwContext = await loadPrBodyweightEnrichmentContext(userId, variations);
        const prReferenceDate = new Date();

        const historicalSets = (await fetchPersonalRecordCandidateSets(
            userId,
            seanceId,
            unit,
            variations,
            isUnilateral,
            unilateralSide
        )).map((set, index) => {
            const refDate = set?.date ? new Date(set.date) : prReferenceDate;
            return applyPrBodyweightEnrichment(
                set,
                bwContext,
                refDate,
                `historical#${index}`,
            );
        });
        const sessionPeerSets = normalizeSessionSetsForPrEvaluation(sessionSets, {
            excludeSetId,
            unit,
            isUnilateral,
            unilateralSide,
        }).map((peer, index) => applyPrBodyweightEnrichment(
            peer,
            bwContext,
            prReferenceDate,
            `sessionPeer#${index}`,
        ));

        logPrEval('historyLoaded', {
            historicalCount: historicalSets.length,
            sessionPeerCount: sessionPeerSets.length,
            historicalSample: historicalSets
                .map((set, index) => ({ index, ...summarizeSetForPrLog(set) }))
                .sort((a, b) => (b.oneRmKg ?? 0) - (a.oneRmKg ?? 0))
                .slice(0, 8),
        });

        if (historicalSets.length === 0 && sessionPeerSets.length === 0) {
            logPrEval('result', { status: 'NB', reason: 'noHistoryNoSessionPeers' });
            return {
                isPersonalRecord: "NB",
                prDetail: {
                    valueDelta: null,
                    repsDelta: null,
                    secondsDelta: null,
                    kgDelta: null,
                    lbsDelta: null,
                    effectiveLoadCurrent: round2(currentEffectiveLoad),
                    effectiveLoadReference: null,
                    effectiveLoadCurrentLbs: currentEffectiveLoadLbs,
                    effectiveLoadReferenceLbs: null,
                    referenceBestSet: null,
                    oneRmDelta: null,
                    oneRmDeltaLbs: null,
                    referencePeakOneRm: null,
                    referencePeakOneRmLbs: null,
                }
            };
        }

        const currentSetForOneRm = applyPrBodyweightEnrichment({
            unit,
            value,
            weightLoad,
            elastic,
            effectiveWeightLoad: currentEffectiveLoad,
        }, bwContext, prReferenceDate, 'current');
        const currentOneRm = resolvePrComparisonOneRmKg(currentSetForOneRm);

        const historicalSameUnit = historicalSets.filter((s) => !unit || s.unit === unit);
        const sessionPeersAthBlock = filterSessionPeersWithStrongerOneRm(
            sessionPeerSets,
            currentOneRm,
        );
        const setsForAthPeak = [...historicalSameUnit, ...sessionPeersAthBlock];

        let maxReferenceOneRm = null;
        for (const referenceSet of setsForAthPeak) {
            const referenceOneRm = resolvePrComparisonOneRmKg(referenceSet);
            if (referenceOneRm != null
                && (maxReferenceOneRm == null || referenceOneRm > maxReferenceOneRm)) {
                maxReferenceOneRm = referenceOneRm;
            }
        }

        const isAth = currentOneRm != null
            && maxReferenceOneRm != null
            && currentOneRm > maxReferenceOneRm;

        const setsSameValue = historicalSameUnit.filter((s) => s.value === value);
        const hasSameValueHistory = setsSameValue.length > 0;
        const currentValue = Number(value);

        logPrEval('athCompare', {
            current: summarizeSetForPrLog(currentSetForOneRm),
            currentOneRmKg: currentOneRm != null ? round2(currentOneRm) : null,
            maxReferenceOneRmKg: maxReferenceOneRm != null ? round2(maxReferenceOneRm) : null,
            isAth,
            hasSameValueHistory,
            sameValueHistoryCount: setsSameValue.length,
            sameValueHistorySample: setsSameValue
                .slice(0, 5)
                .map((set) => summarizeSetForPrLog(set)),
            sessionPeersAthBlockCount: sessionPeersAthBlock.length,
        });

        let status = null;
        let statusReason = null;
        if (isAth) {
            status = "ATH";
            statusReason = 'currentOneRmBeatsPeak';
        } else if (hasSameValueHistory) {
            const maxLoadAtValue = maxEffectiveLoadAmongSets(setsSameValue);
            if (maxLoadAtValue == null) {
                statusReason = 'noFiniteHistoricalLoadAtSameReps';
            } else if (currentEffectiveLoad > maxLoadAtValue + LOAD_EPSILON) {
                status = "PR";
                statusReason = 'higherLoadAtSameReps';
            } else if (Math.abs(currentEffectiveLoad - maxLoadAtValue) <= LOAD_EPSILON) {
                status = "SB";
                statusReason = 'sameLoadAtSameReps';
            } else {
                statusReason = 'belowHistoricalLoadAtSameReps';
            }
        } else {
            // PR « plus de reps/sec à charge égale » : on compare uniquement à l'historique
            // persisté (hors séance courante). Les sessionPeerSets servent à l'ATH, pas à ce chemin.
            const setsAtSameLoad = filterSetsAtSameEffectiveLoad(
                historicalSameUnit,
                currentEffectiveLoad,
            );
            const maxValueAtSameLoad = maxValueAmongSets(setsAtSameLoad);

            if (maxValueAtSameLoad != null && Number.isFinite(currentValue)) {
                if (currentValue > maxValueAtSameLoad) {
                    status = "PR";
                    statusReason = 'higherValueAtSameLoad';
                } else if (currentValue === maxValueAtSameLoad) {
                    status = "SB";
                    statusReason = 'sameValueAtSameLoad';
                } else {
                    statusReason = 'belowHistoricalValueAtSameLoad';
                }
            } else {
                status = "NB";
                statusReason = 'noHistoricalSameRepsOrSecs';
            }
        }

        logPrEval('result', {
            status,
            statusReason,
            maxLoadAtSameValue: hasSameValueHistory
                ? round2(maxEffectiveLoadAmongSets(setsSameValue))
                : null,
            maxValueAtSameLoad: statusReason === 'higherValueAtSameLoad'
                || statusReason === 'sameValueAtSameLoad'
                || statusReason === 'belowHistoricalValueAtSameLoad'
                ? maxValueAmongSets(filterSetsAtSameEffectiveLoad(
                    historicalSameUnit,
                    currentEffectiveLoad,
                ))
                : null,
        });

        let referenceBestSet = null;
        if (statusReason === 'higherLoadAtSameReps' || statusReason === 'sameLoadAtSameReps') {
            referenceBestSet = getReferenceBestSetAtSameReps(historicalSameUnit, value);
        } else if (statusReason === 'higherValueAtSameLoad'
            || statusReason === 'sameValueAtSameLoad') {
            referenceBestSet = getReferenceBestSetAtSameLoad(
                filterSetsAtSameEffectiveLoad(historicalSameUnit, currentEffectiveLoad),
                currentEffectiveLoad,
            );
        }

        const referenceEffectiveLoad = referenceBestSet
            ? getEffectiveLoadPreferringPersisted(referenceBestSet)
            : null;
        const referenceEffectiveLoadLbs = referenceBestSet
            ? getEffectiveLoadLbsPreferringPersisted(referenceBestSet)
            : null;

        let repsDelta = null;
        let secondsDelta = null;
        let kgDelta = null;
        let lbsDelta = null;

        if (status === 'PR' && referenceBestSet) {
            if (statusReason === 'higherValueAtSameLoad') {
                const referenceValue = Number(referenceBestSet.value);
                if (Number.isFinite(referenceValue)) {
                    const valueDelta = round2(currentValue - referenceValue);
                    if (unit === 'seconds') {
                        secondsDelta = valueDelta;
                    } else {
                        repsDelta = valueDelta;
                    }
                }
            } else if (statusReason === 'higherLoadAtSameReps'
                && referenceEffectiveLoad != null) {
                kgDelta = round2(currentEffectiveLoad - referenceEffectiveLoad);
                lbsDelta = referenceEffectiveLoadLbs != null
                    ? round2(currentEffectiveLoadLbs - referenceEffectiveLoadLbs)
                    : null;
            }
        }
        const oneRmDelta = currentOneRm != null && maxReferenceOneRm != null
            ? round2(currentOneRm - maxReferenceOneRm)
            : null;
        const oneRmDeltaLbs = oneRmDelta != null ? round2(oneRmDelta * KG_TO_LB) : null;
        const referencePeakOneRm = status === 'ATH' && maxReferenceOneRm != null
            ? round2(maxReferenceOneRm)
            : null;
        const referencePeakOneRmLbs = referencePeakOneRm != null
            ? round2(referencePeakOneRm * KG_TO_LB)
            : null;

        const athBodyweightMeta = status === 'ATH'
            ? resolveAthBodyweightDriver({
                bwContext,
                currentSetForOneRm,
                currentOneRm,
                maxReferenceOneRm,
                setsForAthPeak,
                value,
                currentEffectiveLoad,
            })
            : null;

        if (athBodyweightMeta) {
            logPrEval('athBodyweightDriver', athBodyweightMeta);
        }

        return {
            isPersonalRecord: status,
            prDetail: {
                valueDelta: repsDelta ?? secondsDelta,
                repsDelta,
                secondsDelta,
                kgDelta,
                lbsDelta,
                effectiveLoadCurrent: round2(currentEffectiveLoad),
                effectiveLoadReference: referenceEffectiveLoad != null ? round2(referenceEffectiveLoad) : null,
                effectiveLoadCurrentLbs: currentEffectiveLoadLbs,
                effectiveLoadReferenceLbs: referenceEffectiveLoadLbs,
                referenceBestSet,
                oneRmDelta: status === 'ATH' ? oneRmDelta : null,
                oneRmDeltaLbs: status === 'ATH' ? oneRmDeltaLbs : null,
                referencePeakOneRm,
                referencePeakOneRmLbs,
                ...(athBodyweightMeta || {}),
            }
        };


    } catch (error) {
        console.error('Error checking for personal record:', error);
        return { isPersonalRecord: null, prDetail: null };
    }
}

function getEffectiveLoadLbsPreferringPersisted(set) {
    const persistedLbs = set?.effectiveWeightLoadLbs;
    if (persistedLbs != null && Number.isFinite(Number(persistedLbs))) {
        return Number(persistedLbs);
    }
    const persistedKg = set?.effectiveWeightLoad;
    if (persistedKg != null && Number.isFinite(Number(persistedKg))) {
        return round2(Number(persistedKg) * KG_TO_LB);
    }
    const weightLoadLbs = set?.weightLoadLbs;
    if (weightLoadLbs != null && Number.isFinite(Number(weightLoadLbs))) {
        return Number(weightLoadLbs);
    }
    return round2(getEffectiveLoad(set) * KG_TO_LB);
}

const pickHistoricalSetWithMaxLoad = (pool) => pool.reduce((best, current) => {
    if (!best) return current;
    const bestLoad = getEffectiveLoadPreferringPersisted(best);
    const currentLoad = getEffectiveLoadPreferringPersisted(current);
    return currentLoad > bestLoad ? current : best;
}, null);

/** Meilleure série historique au même nombre de reps / secondes (référence deltas PR). */
function getReferenceBestSetAtSameReps(sets, currentValue) {
    if (!sets.length) return null;
    const targetValue = Number.isFinite(Number(currentValue)) ? Number(currentValue) : 0;

    const atSameReps = sets.filter((set) => Number(set.value) === targetValue);
    if (!atSameReps.length) return null;

    return pickHistoricalSetWithMaxLoad(atSameReps);
}

/**
 * Version enrichie de l'évaluation PR: conserve le statut et ajoute les deltas
 * vs meilleur set historique strict (mêmes variations + même unit).
 */
async function isPersonalRecordWithDetail(
    userId,
    seanceId,
    unit,
    value,
    weightLoad,
    elastic,
    variations,
    effectiveWeightLoadOverride,
    isUnilateral = undefined,
    unilateralSide = undefined,
    sessionSets = undefined,
    excludeSetId = undefined,
    cardio = undefined,
) {
    return evaluatePersonalRecordWithContext(
        userId,
        seanceId,
        unit,
        value,
        weightLoad,
        elastic,
        variations,
        effectiveWeightLoadOverride,
        isUnilateral,
        unilateralSide,
        sessionSets,
        excludeSetId,
        cardio,
    );
}



/**
 * Create a new set.
 * @param {Object} setData - The set data.
 * @returns {Promise<Object>} - A promise that resolves to the new set object.
 */
async function createSet(setData) {
    try {
        const payload = mergePersistedOptionalFieldsFromClient(setData);
        if (payload.value != null && payload.value !== '') {
            const parsedValue = Number(payload.value);
            if (Number.isFinite(parsedValue)) {
                payload.value = parsedValue;
            }
        }
        if (!payload.program && payload.seance) {
            const parentSeance = await Seance.findById(payload.seance).select('program').lean();
            if (parentSeance?.program) {
                payload.program = parentSeance.program;
            }
        }
        const newSet = await Set.create(payload);
        return newSet;
    } catch (err) {
        console.error("Error creating set:", err);
        throw err;
    }
}

/**
 * Delete sets of a seance
 * @param {string} seanceId - The ID of the seance.
 */
async function deleteSets(seanceId) {
    try {
        await Set.deleteMany({ seance: seanceId });
    } catch (err) {
        console.error("Error deleting sets:", err);
        throw err;
    }
}

// Export the functions
module.exports = {
    getSortedVariationIds,
    getVariationSignature,
    resolveExpandedLeafVariationIds,
    loadVariationByIdClosure,
    getAlternativeVariationGroups,
    resolveFamilySeedIds,
    resolveMultiInputFamilySeedIds,
    buildVariationPrefixes,
    getSets,
    getTopExercices,
    createSet,
    getPRs,
    getDetailedPRs,
    getProgressionPRs,
    getProgressionDetailedPRs,
    getFigurePRs,
    getFigureDetailedPRs,
    getLastFormats,
    deleteSets,
    isPersonalRecord,
    isPersonalRecordWithDetail,
    getReferenceBestSetAtSameReps,
    getMyExercicesSearch,
    getMyExercicesAll,
    getPersonalRecordsSummary,
    getNormalizedProgressionTimeseries,
    getCardioProgressionTimeseries,
    getNormalFlowPerformedVariationFamilies,
    resolvePerformedFamilyTargets,
    resolveFigureRecommendationAllowlist,
    collectProgressionEdgeNeighbors,
};

