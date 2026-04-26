const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();
const { compareAndAssignPR, getEffectiveLoad, getEffectiveLoadPreferringPersisted } = require('../utils/set');
const { mergePersistedOptionalFieldsFromClient, KG_TO_LB, round2 } = require('../utils/seanceSetPersistedFields');
const Variation = require('../schema/variation');
const UserMeasure = require('../schema/userMeasure');
const { buildMyExercisesSearchCompound } = require('./variationSearchPipelines');
const {
    secondsToEquivalentReps,
    getEffectiveLoadKg,
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley
} = require('../utils/oneRepMax');
const {
    getDifficultyRatio,
    buildCanonicalVariationMap,
    resolveCanonicalVariationIdFromIds,
    toSortedSignature,
    buildAdjacencyList
} = require('./variationDifficultyGraph');
const VariationProgressionEdge = require('../schema/variationProgressionEdge');
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

async function getAlternativeVariationGroups(variationIds = []) {
    const baseIds = getSortedVariationIds(variationIds);
    const uniqueGroups = new Map();

    if (baseIds.length === 0) {
        return [];
    }

    uniqueGroups.set(getVariationSignature(baseIds), baseIds);

    const baseObjectIds = baseIds.map(id => new mongoose.Types.ObjectId(id));

    // Multi-variations input: only map to verified singleton variations whose
    // equivalentTo matches the full set exactly.
    const equivalentVerifiedVariations = await Variation.find(
        {
            verified: true,
            equivalentTo: {
                $size: baseIds.length,
                $all: baseObjectIds
            }
        },
        { _id: 1 }
    );

    for (const variation of equivalentVerifiedVariations) {
        const verifiedSingleton = [variation._id.toString()];
        uniqueGroups.set(getVariationSignature(verifiedSingleton), verifiedSingleton);
    }

    // Singleton input: include equivalent groups for backward-compatible retrieval.
    if (baseIds.length === 1) {
        const baseObjectId = new mongoose.Types.ObjectId(baseIds[0]);
        const variationMeta = await Variation.findById(
            baseObjectId,
            { verified: 1, equivalentTo: 1, isExercice: 1, name: 1 }
        ).lean();
        const canonicalVariation = await Variation.findOne(
            { _id: baseObjectId },
            { equivalentTo: 1 }
        );

        if (canonicalVariation?.equivalentTo?.length) {
            const equivalentGroup = getSortedVariationIds(canonicalVariation.equivalentTo);
            uniqueGroups.set(getVariationSignature(equivalentGroup), equivalentGroup);
        }

        // Reverse lookup: only for detail variations.
        // For exercise targets (e.g. "Human flag"), we keep strict singleton behavior
        // and avoid pulling canonical groups like "Tuck Human Flag".
        if (variationMeta?.isExercice !== true) {
            const reverseCanonicalGroups = await Variation.find(
                {
                    verified: true,
                    equivalentTo: baseObjectId
                },
                { equivalentTo: 1 }
            ).lean();
            for (const doc of reverseCanonicalGroups) {
                const group = getSortedVariationIds(doc?.equivalentTo || []);
                if (group.length > 0) {
                    uniqueGroups.set(getVariationSignature(group), group);
                }
            }
        }
    }

    if (baseIds.length === 1) {
        const variationMeta = await Variation.findById(
            new mongoose.Types.ObjectId(baseIds[0]),
            { verified: 1, equivalentTo: 1, isExercice: 1, name: 1 }
        ).lean();
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

function resolveUserHeightMultiplierForDate(userMeasures, date) {
    if (!Array.isArray(userMeasures) || !userMeasures.length) return 1;
    const target = date ? new Date(date) : new Date();
    const targetMs = Number.isFinite(target.getTime()) ? target.getTime() : Date.now();
    let latestBefore = null;
    for (const measure of userMeasures) {
        const at = new Date(measure?.measuredAt);
        if (!Number.isFinite(at.getTime())) continue;
        if (at.getTime() <= targetMs) latestBefore = measure;
        else break;
    }
    const chosen = latestBefore ?? userMeasures[userMeasures.length - 1];
    const m = Number(chosen?.heightMultiplier);
    return Number.isFinite(m) && m > 0 ? m : 1;
}

function resolveUserWeightKgForDate(userMeasures, date) {
    if (!Array.isArray(userMeasures) || !userMeasures.length) return null;
    const target = date ? new Date(date) : new Date();
    const targetMs = Number.isFinite(target.getTime()) ? target.getTime() : Date.now();
    let latestBefore = null;
    for (const measure of userMeasures) {
        const at = new Date(measure?.measuredAt);
        if (!Number.isFinite(at.getTime())) continue;
        if (at.getTime() <= targetMs) latestBefore = measure;
        else break;
    }
    const chosen = latestBefore ?? userMeasures[userMeasures.length - 1];
    const kg = Number(chosen?.weight?.kg);
    return Number.isFinite(kg) && kg > 0 ? kg : null;
}

function getVariationIdsFromSetDoc(setDoc) {
    return (setDoc?.variations || [])
        .map((v) => (v?.variation != null ? String(v.variation) : null))
        .filter(Boolean);
}

/**
 * Pour la progression normalisée : si la variation est une feuille composée
 * (ex. tuck back lever) avec `equivalentTo`, le premier id désigne l'exercice
 * principal (ex. back lever) et sert d'ancre comme si le client l'avait envoyé.
 */
async function resolveMainExerciseIdForProgression(mainExerciseId) {
    if (!mainExerciseId || !mongoose.Types.ObjectId.isValid(mainExerciseId)) return null;
    const idStr = String(mainExerciseId);
    const doc = await Variation.findById(idStr, { equivalentTo: 1 }).lean();
    const first = doc?.equivalentTo?.[0];
    if (first != null) {
        const firstStr = String(first);
        if (mongoose.Types.ObjectId.isValid(firstStr)) return firstStr;
    }
    return idStr;
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

function toRoundedOrNull(value, decimals = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = 10 ** decimals;
    return Math.round((n + Number.EPSILON) * factor) / factor;
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

    const userMeasures = mongoose.Types.ObjectId.isValid(userId)
        ? await UserMeasure.find(
            { userId: new mongoose.Types.ObjectId(userId) },
            { measuredAt: 1, heightMultiplier: 1, "weight.kg": 1 }
        ).sort({ measuredAt: 1 }).lean()
        : [];
    const targetHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, new Date());

    const augmentedSets = [];

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

        const canResolveDifficulty = Boolean(sourceCanonicalVariationId && targetCanonicalVariationId);
        const difficultyOpts = adjacencyPrebuilt != null
            ? { adjacency: adjacencyPrebuilt }
            : {};
        const difficultyFromCanonical = canResolveDifficulty
            ? await getDifficultyRatio({
                fromVariationId: sourceCanonicalVariationId,
                toVariationId: targetCanonicalVariationId,
                contextVariationId: normalizedMainExerciseId || undefined,
                ...difficultyOpts
            })
            : null;
        const difficultyFromDetail = canResolveDifficulty && sourceDetailVariationId
            ? await getDifficultyRatio({
                fromVariationId: sourceDetailVariationId,
                toVariationId: targetCanonicalVariationId,
                contextVariationId: normalizedMainExerciseId || undefined,
                ...difficultyOpts
            })
            : null;
        const difficulty = Number.isFinite(Number(difficultyFromDetail?.ratio)) && Number(difficultyFromDetail.ratio) > 0
            ? difficultyFromDetail
            : difficultyFromCanonical;
        const ratio = Number.isFinite(Number(difficulty?.ratio)) && Number(difficulty.ratio) > 0
            ? Number(difficulty.ratio)
            : 1;

        const sourceHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, set?.date);
        const morphologyFactor = targetHeightMultiplier / sourceHeightMultiplier;
        const difficultyFactor = (1 / ratio) * morphologyFactor;

        const sourcePolicyDocs = sourceVariationIds
            .map((id) => variationByIdForPolicy.get(String(id)))
            .filter((doc) => doc?.isExercice === true);
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
        const userWeightKg = resolveUserWeightKgForDate(userMeasures, set?.date);
        const weightedBodyweightKg = includeBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * Number(exerciseBodyWeightRatio)
            : 0;
        const effectiveLoad = getEffectiveLoadKg(set, {
            includeBodyweight: includeBodyweight,
            userWeightKg: weightedBodyweightKg
        });
        const normalizedEffectiveLoad = Number.isFinite(effectiveLoad)
            ? Math.round((effectiveLoad * difficultyFactor + Number.EPSILON) * 1000) / 1000
            : null;
        const repsEquivalent = set.unit === 'seconds'
            ? secondsToEquivalentReps(set.value)
            : set.value;
        const normalizedBrzycki = Number.isFinite(normalizedEffectiveLoad) && Number.isFinite(Number(repsEquivalent)) && Number(repsEquivalent) > 0
            ? toRoundedOrNull(estimateOneRepMaxBrzycki(normalizedEffectiveLoad, Number(repsEquivalent)))
            : null;
        const normalizedEpley = Number.isFinite(normalizedEffectiveLoad) && Number.isFinite(Number(repsEquivalent)) && Number(repsEquivalent) > 0
            ? toRoundedOrNull(estimateOneRepMaxEpley(normalizedEffectiveLoad, Number(repsEquivalent)))
            : null;
        const normalizedOneRm = normalizedBrzycki != null && normalizedEpley != null
            ? toRoundedOrNull((normalizedBrzycki + normalizedEpley) / 2)
            : (normalizedBrzycki ?? normalizedEpley);

        augmentedSets.push({
            ...set,
            rawEffectiveWeightLoad: Number.isFinite(effectiveLoad) ? effectiveLoad : null,
            repsEquivalent: Number.isFinite(Number(repsEquivalent)) ? Number(repsEquivalent) : null,
            normalizedEffectiveWeightLoad: normalizedEffectiveLoad,
            normalizedBrzycki,
            normalizedEpley,
            normalizedOneRm,
            sourceVariationId: sourceDetailVariationId || sourceCanonicalVariationId || null,
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
    isUnilateral = undefined
}) {
    const targetVariationIds = parseVariationIdsFromControllerInput(referenceVariations);
    const targetCanonicalVariationId = await resolveCanonicalVariationIdFromIds(targetVariationIds);

    let normalizedMainExerciseId = mongoose.Types.ObjectId.isValid(mainExerciseId)
        ? String(mainExerciseId)
        : null;
    if (normalizedMainExerciseId) {
        normalizedMainExerciseId = await resolveMainExerciseIdForProgression(normalizedMainExerciseId);
    }

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

    const allGroups = [
        targetVariationIds,
        ...filteredSets.map((setDoc) => getVariationIdsFromSetDoc(setDoc))
    ].filter((g) => Array.isArray(g) && g.length > 0);
    const canonicalBySignature = await buildCanonicalVariationMap(allGroups);

    const adjacencyPrebuiltTimeseries = normalizedMainExerciseId
        ? await buildAdjacencyList({ contextVariationId: normalizedMainExerciseId })
        : null;
    const difficultyOptsTs = adjacencyPrebuiltTimeseries != null
        ? { adjacency: adjacencyPrebuiltTimeseries }
        : {};

    const points = [];
    for (const setDoc of filteredSets) {
        const set = typeof setDoc.toObject === 'function' ? setDoc.toObject() : setDoc;
        const sourceVariationIds = getVariationIdsFromSetDoc(set);
        if (!sourceVariationIds.length) continue;
        const sourceCanonicalVariationId = canonicalBySignature.get(toSortedSignature(sourceVariationIds)) || sourceVariationIds[0];
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
            contextVariationId: normalizedMainExerciseId || undefined,
            ...difficultyOptsTs
        });
        const difficultyFromDetail = sourceDetailVariationId
            ? await getDifficultyRatio({
                fromVariationId: sourceDetailVariationId,
                toVariationId: targetCanonicalVariationId,
                contextVariationId: normalizedMainExerciseId || undefined,
                ...difficultyOptsTs
            })
            : null;
        const difficulty = Number.isFinite(Number(difficultyFromDetail?.ratio)) && Number(difficultyFromDetail.ratio) > 0
            ? difficultyFromDetail
            : difficultyFromCanonical;
        const ratio = Number.isFinite(Number(difficulty?.ratio)) && Number(difficulty.ratio) > 0
            ? Number(difficulty.ratio)
            : 1;
        const sourceHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, set?.date);
        const morphologyFactor = targetHeightMultiplier / sourceHeightMultiplier;
        const difficultyFactor = (1 / ratio) * morphologyFactor;

        const sourcePolicyDocs = sourceVariationIds
            .map((id) => variationByIdForPolicy.get(String(id)))
            .filter((doc) => doc?.isExercice === true);
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
        const userWeightKg = resolveUserWeightKgForDate(userMeasures, set?.date);
        const weightedBodyweightKg = includeBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * Number(exerciseBodyWeightRatio)
            : 0;
        const effectiveLoad = getEffectiveLoadKg(set, {
            includeBodyweight: includeBodyweight,
            userWeightKg: weightedBodyweightKg
        });
        const normalizedEffectiveLoad = Number.isFinite(effectiveLoad)
            ? Math.round((effectiveLoad * difficultyFactor + Number.EPSILON) * 1000) / 1000
            : null;
        const repsEquivalent = set.unit === 'seconds'
            ? secondsToEquivalentReps(set.value)
            : set.value;
        const normalizedBrzycki = Number.isFinite(normalizedEffectiveLoad) && Number.isFinite(Number(repsEquivalent)) && Number(repsEquivalent) > 0
            ? toRoundedOrNull(estimateOneRepMaxBrzycki(normalizedEffectiveLoad, Number(repsEquivalent)))
            : null;
        const normalizedEpley = Number.isFinite(normalizedEffectiveLoad) && Number.isFinite(Number(repsEquivalent)) && Number(repsEquivalent) > 0
            ? toRoundedOrNull(estimateOneRepMaxEpley(normalizedEffectiveLoad, Number(repsEquivalent)))
            : null;
        const normalizedOneRm = normalizedBrzycki != null && normalizedEpley != null
            ? toRoundedOrNull((normalizedBrzycki + normalizedEpley) / 2)
            : (normalizedBrzycki ?? normalizedEpley);

        points.push({
            setId: set._id,
            date: set.date,
            unit: set.unit,
            mergedVariationsNames: set?.mergedVariationsNames || null,
            rawValue: set.value,
            rawWeightLoad: set.weightLoad,
            rawElastic: set.elastic,
            rawEffectiveWeightLoad: Number.isFinite(effectiveLoad) ? effectiveLoad : null,
            repsEquivalent: Number.isFinite(Number(repsEquivalent)) ? Number(repsEquivalent) : null,
            normalizedEffectiveWeightLoad: normalizedEffectiveLoad,
            normalizedBrzycki,
            normalizedEpley,
            normalizedOneRm,
            sourceVariationId: sourceDetailVariationId || sourceCanonicalVariationId,
            targetVariationId: targetCanonicalVariationId,
            difficultyRatioUsed: ratio,
            heightMultiplierUsed: {
                source: sourceHeightMultiplier,
                target: targetHeightMultiplier
            },
            path: Array.isArray(difficulty?.path) ? difficulty.path : [],
            pathNames: (Array.isArray(difficulty?.path) ? difficulty.path : []).map((id) => {
                const doc = variationByIdForPolicy.get(String(id));
                if (!doc?.name) return String(id);
                return {
                    id: String(id),
                    fr: doc.name.fr || null,
                    en: doc.name.en || null
                };
            }),
            hops: Number.isFinite(Number(difficulty?.hops)) ? Number(difficulty.hops) : null
        });
    }

    let peak = null;
    for (const p of points) {
        if (!Number.isFinite(Number(p?.normalizedOneRm))) continue;
        if (!peak || Number(p.normalizedOneRm) > Number(peak.normalizedOneRm)) {
            peak = {
                setId: p.setId,
                date: p.date,
                normalizedOneRm: p.normalizedOneRm,
                normalizedOneRmLbs: toRoundedOrNull(Number(p.normalizedOneRm) * KG_TO_LB, 2),
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

    return {
        points,
        meta: {
            targetVariationId: targetCanonicalVariationId,
            mainExerciseId: normalizedMainExerciseId,
            mainVariationName,
            mergedVariationsNames: mergedVariationsNamesMeta,
            mandatoryMorphology: true,
            graphEnabled: true,
            count: points.length,
            strengthPeakNormalized: peak
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
        Last: { repetitions: null, seconds: null }
    };
    for (const set of sets) {
        const categoriesForSet = classifySet(set.unit, set.value);
        for (const category of categoriesForSet) {
            if (prs[category]) {
                prs[category][set.unit] = compareAndAssignPR(prs[category][set.unit], set);
            }
        }
    }
    const repSets = sets.filter(s => s.unit === 'repetitions');
    const secSets = sets.filter(s => s.unit === 'seconds');
    prs.Last.repetitions = repSets[repSets.length - 1] || null;
    prs.Last.seconds = secSets[secSets.length - 1] || null;
    return prs;
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
 * Get PRs for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} excludedSeanceId - The seance ID to exclude from PR computation (optional).
 * @param {string} exercice - The ID of the exercice (optional).
 * @param {Array<string>} categories - The array of category JSON strings (optional).
 * @param {string} dateMin - The minimum date (optional).
 * @param {Array<string>} variations - The array of variation IDs (optional).
 * @returns {Promise<Object>} - PRs categorized by Puissance/Force/Volume/Endurance, plus Last.
 */
async function getPRs(userId, excludedSeanceId, exercice, categories, dateMin, variations, unilateralSide) {
    try {
        const rawSets = await fetchSetsForPR(userId, excludedSeanceId, exercice, categories, dateMin, variations, unilateralSide);
        const sets = await augmentSetsWithNormalizedMetrics({
            sets: rawSets,
            userId,
            referenceVariations: variations,
            mainExerciseId: exercice
        });
        return computePrsFromAugmentedSets(sets);
    } catch (err) {
        console.error("Error fetching PRs:", err);
        throw err;
    }
}

/**
 * PRs par nombre de reps / secondes (nRM), sans regroupement par catégorie physiologique.
 * Chaque clé `"nRM"` contient le meilleur set pour `repetitions` et pour `seconds` à cette valeur n (arrondi par le bas).
 * @returns {Promise<Object>} - { "1RM": { repetitions, seconds }, "2RM": {...}, ..., Last: { repetitions, seconds } }
 */
async function getDetailedPRs(userId, exercice, categories, dateMin, variations, unilateralSide) {
    try {
        // Keep argument order aligned with fetchSetsForPR(userId, excludedSeanceId, exercice, categories, dateMin, variations)
        const rawSets = await fetchSetsForPR(userId, null, exercice, categories, dateMin, variations, unilateralSide);
        const sets = await augmentSetsWithNormalizedMetrics({
            sets: rawSets,
            userId,
            referenceVariations: variations,
            mainExerciseId: exercice
        });
        return computeDetailedPrsFromAugmentedSets(sets);
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
    unilateralSide = undefined
}) {
    const inputVariationIds = (Array.isArray(variations) ? variations : [variations])
        .map((id) => String(id))
        .filter(Boolean);
    if (!inputVariationIds.length) {
        throw new Error('variations invalide: liste vide');
    }
    if (!inputVariationIds.every((id) => mongoose.Types.ObjectId.isValid(id))) {
        throw new Error('variations invalide: ids invalides');
    }

    let familySeedIds = [];
    if (inputVariationIds.length === 1) {
        const rootVariationIdStr = String(inputVariationIds[0]);
        const rootVariationDoc = await Variation.findById(
            rootVariationIdStr,
            { equivalentTo: 1, isExercice: 1 }
        ).lean();
        familySeedIds = resolveFamilySeedIds(rootVariationIdStr, rootVariationDoc);
    } else {
        const seen = new global.Set();
        for (const id of inputVariationIds) {
            if (!seen.has(String(id))) {
                familySeedIds.push(String(id));
                seen.add(String(id));
            }
        }
    }
    if (!familySeedIds.length) {
        throw new Error('impossible de construire la famille à partir de variations');
    }
    const rootExerciseId = String(familySeedIds[0]);
    const rootVariationIdStr = String(inputVariationIds[0]);

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

    const rawSets = await fetchSetsForPR(
        userId,
        null,
        null,
        null,
        dateMin,
        null,
        unilateralSide
    );
    const familySets = Array.isArray(rawSets) ? rawSets : [];

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

    const allVariationIds = new global.Set([rootExerciseId, ...familySeedIds, ...inputVariationIds]);
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

            const sortedVariationIds = getSortedVariationIds(setVariationIds);
            const variationSignature = sortedVariationIds.join('|');
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

        const rows = [...groupedByVariationSignature.entries()].map(([, aggregate]) => {
            const preferredVariationId = [...aggregate.variationCandidateCounts.entries()]
                .sort((a, b) => b[1] - a[1])[0]?.[0] || rootExerciseId;
            const scopedVariationId = String(preferredVariationId);
            const preferredOrder = [...aggregate.variationOrderCounts.values()]
                .sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return a.firstSeenAt - b.firstSeenAt;
                })[0]?.order || aggregate.variations;
            const fallbackLabel = getPreferredVariationLabel(variationById.get(String(preferredVariationId)))
                || aggregate.variations.join(' + ')
                || rootVariationIdStr;
            const bestMergedName = [...aggregate.mergedNameCounts.entries()]
                .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
            const label = bestMergedName || fallbackLabel;

            return {
                variationId: String(preferredVariationId),
                scopedVariationId,
                scopeVariationIds: String(scopedVariationId) === String(preferredVariationId)
                    ? [String(preferredVariationId)]
                    : [String(rootExerciseId), String(preferredVariationId)],
                variations: preferredOrder,
                sourceVariationIds: preferredOrder,
                name: { fr: label, en: null },
                fallbackMergedName: null,
                isExercice: variationById.get(String(preferredVariationId))?.isExercice === true,
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

    return {
        families,
        performedVariationsByFamily,
        meta: {
            inputVariations: inputVariationIds,
            familySeedVariations: familySeedIds,
            rootExerciseId,
            maxDepthApplied,
            maxFamiliesApplied: NORMAL_FLOW_MAX_FAMILIES
        }
    };
}

async function collectTargetVariationIdsForFigureFamily({
    familySets,
    normalizedMainExerciseId,
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

    let graphIds = [];
    if (includeAllGraphTargets) {
        graphIds = await collectGraphVariationNodeIdsForContext(normalizedMainExerciseId);
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

async function getFigurePRs({
    userId,
    excludedSeanceId = null,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    referenceVariations,
    mainExerciseId,
    includeAllGraphTargets = false,
    maxTargets = 40
}) {
    const referenceIds = parseVariationIdsFromControllerInput(referenceVariations);
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

    let rawSets = await fetchSetsForPR(userId, excludedSeanceId, exercice, categories, dateMin, null, unilateralSide);
    rawSets = await filterSetsToMainExerciseFamily(rawSets, normalizedMainExerciseId);

    const {
        targetIds,
        totalDistinctTargets,
        capped,
        maxTargetsApplied
    } = await collectTargetVariationIdsForFigureFamily({
        familySets: rawSets,
        normalizedMainExerciseId,
        referenceCanonicalId: referenceCanonicalId,
        includeAllGraphTargets,
        maxTargets
    });

    const adjacency = await buildAdjacencyList({ contextVariationId: normalizedMainExerciseId });
    const namesMap = await resolveFigurePrNamesMap(targetIds);
    const targetVariationDocs = await Variation.find(
        { _id: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(String(id))) } },
        { isExercice: 1 }
    ).lean();
    const targetIsExerciseById = new Map(
        targetVariationDocs.map((doc) => [String(doc._id), doc?.isExercice === true])
    );

    const entries = [];
    for (const variationId of targetIds) {
        const isDirectEntry = String(variationId) === String(referenceCanonicalId);
        const targetIsExercise = targetIsExerciseById.get(String(variationId)) === true;
        const variationFilterInput = targetIsExercise
            ? variationId
            : [normalizedMainExerciseId, variationId];
        const variationMatchMode = targetIsExercise ? 'exact' : 'contains';
        const setsForAugment = await fetchSetsForPR(
            userId,
            excludedSeanceId,
            exercice,
            categories,
            dateMin,
            variationFilterInput,
            unilateralSide,
            variationMatchMode
        );
        const mainForAugment = isDirectEntry && exercice != null && String(exercice) !== ''
            ? exercice
            : normalizedMainExerciseId;
        const augmented = await augmentSetsWithNormalizedMetrics({
            sets: setsForAugment,
            userId,
            referenceVariations: referenceCanonicalId,
            mainExerciseId: mainForAugment,
            adjacencyPrebuilt: adjacency
        });
        const prs = computePrsFromAugmentedSets(augmented);
        const repPeaks = {
            puissance: prs?.Puissance?.repetitions?._id ? String(prs.Puissance.repetitions._id) : null,
            force: prs?.Force?.repetitions?._id ? String(prs.Force.repetitions._id) : null,
            volume: prs?.Volume?.repetitions?._id ? String(prs.Volume.repetitions._id) : null,
            endurance: prs?.Endurance?.repetitions?._id ? String(prs.Endurance.repetitions._id) : null
        };
        const ratioCounts = augmented.reduce((acc, setDoc) => {
            const key = Number.isFinite(Number(setDoc?.difficultyRatioUsed))
                ? String(Number(setDoc.difficultyRatioUsed))
                : 'null';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const maxNormalizedOneRmPoint = augmented.reduce((best, setDoc) => {
            const v = Number(setDoc?.normalizedOneRm);
            if (!Number.isFinite(v)) return best;
            if (!best || v > Number(best?.normalizedOneRm)) return setDoc;
            return best;
        }, null);
        const topNormalizedCandidates = [...augmented]
            .filter((s) => Number.isFinite(Number(s?.normalizedOneRm)))
            .sort((a, b) => Number(b.normalizedOneRm) - Number(a.normalizedOneRm))
            .slice(0, 3)
            .map((s) => ({
                setId: s?._id ? String(s._id) : null,
                date: s?.date || null,
                normalizedOneRm: s?.normalizedOneRm ?? null,
                rawValue: s?.value ?? null,
                rawWeightLoad: s?.weightLoad ?? null,
                variations: (s?.variations || []).map((v) => (v?.variation ? String(v.variation) : null)).filter(Boolean)
            }));
        const selectedNormalizedByCategory = {
            puissance: prs?.Puissance?.repetitions?.normalizedOneRm ?? null,
            force: prs?.Force?.repetitions?.normalizedOneRm ?? null,
            volume: prs?.Volume?.repetitions?.normalizedOneRm ?? null,
            endurance: prs?.Endurance?.repetitions?.normalizedOneRm ?? null
        };
        entries.push({
            variationId: String(variationId),
            isDirect: isDirectEntry,
            name: namesMap.get(String(variationId)) || null,
            prs
        });
    }

    return {
        mainExerciseId: normalizedMainExerciseId,
        referenceVariationId: String(referenceCanonicalId),
        entries,
        meta: {
            familySetCount: rawSets.length,
            totalDistinctTargets,
            returnedTargets: entries.length,
            maxTargets: maxTargetsApplied,
            capped,
            includeAllGraphTargets: Boolean(includeAllGraphTargets)
        }
    };
}

async function getFigureDetailedPRs({
    userId,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    referenceVariations,
    mainExerciseId,
    includeAllGraphTargets = false,
    maxTargets = 40
}) {
    const referenceIds = parseVariationIdsFromControllerInput(referenceVariations);
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

    let rawSets = await fetchSetsForPR(userId, null, exercice, categories, dateMin, null, unilateralSide);
    rawSets = await filterSetsToMainExerciseFamily(rawSets, normalizedMainExerciseId);

    const {
        targetIds,
        totalDistinctTargets,
        capped,
        maxTargetsApplied
    } = await collectTargetVariationIdsForFigureFamily({
        familySets: rawSets,
        normalizedMainExerciseId,
        referenceCanonicalId: referenceCanonicalId,
        includeAllGraphTargets,
        maxTargets
    });

    const adjacency = await buildAdjacencyList({ contextVariationId: normalizedMainExerciseId });
    const namesMap = await resolveFigurePrNamesMap(targetIds);
    const targetVariationDocs = await Variation.find(
        { _id: { $in: targetIds.map((id) => new mongoose.Types.ObjectId(String(id))) } },
        { isExercice: 1 }
    ).lean();
    const targetIsExerciseById = new Map(
        targetVariationDocs.map((doc) => [String(doc._id), doc?.isExercice === true])
    );

    const entries = [];
    for (const variationId of targetIds) {
        const isDirectEntry = String(variationId) === String(referenceCanonicalId);
        const targetIsExercise = targetIsExerciseById.get(String(variationId)) === true;
        const variationFilterInput = targetIsExercise
            ? variationId
            : [normalizedMainExerciseId, variationId];
        const variationMatchMode = targetIsExercise ? 'exact' : 'contains';
        const setsForAugment = await fetchSetsForPR(
            userId,
            null,
            exercice,
            categories,
            dateMin,
            variationFilterInput,
            unilateralSide,
            variationMatchMode
        );
        const mainForAugment = isDirectEntry && exercice != null && String(exercice) !== ''
            ? exercice
            : normalizedMainExerciseId;
        const augmented = await augmentSetsWithNormalizedMetrics({
            sets: setsForAugment,
            userId,
            referenceVariations: variationId,
            mainExerciseId: mainForAugment,
            adjacencyPrebuilt: adjacency
        });
        const prs = computeDetailedPrsFromAugmentedSets(augmented);
        const rmKeys = Object.keys(prs || {}).filter((k) => k === 'Last' || /^\d+RM$/.test(k)).sort((a, b) => {
            if (a === 'Last') return 1;
            if (b === 'Last') return -1;
            return Number(a.replace('RM', '')) - Number(b.replace('RM', ''));
        });
        const rmPeaks = rmKeys.slice(0, 5).map((k) => ({
            key: k,
            repSetId: prs?.[k]?.repetitions?._id ? String(prs[k].repetitions._id) : null,
            repValue: prs?.[k]?.repetitions?.value ?? null
        }));
        entries.push({
            variationId: String(variationId),
            isDirect: isDirectEntry,
            name: namesMap.get(String(variationId)) || null,
            prs
        });
    }

    return {
        mainExerciseId: normalizedMainExerciseId,
        referenceVariationId: String(referenceCanonicalId),
        entries,
        meta: {
            familySetCount: rawSets.length,
            totalDistinctTargets,
            returnedTargets: entries.length,
            maxTargets: maxTargetsApplied,
            capped,
            includeAllGraphTargets: Boolean(includeAllGraphTargets)
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
                }

                // Find overall best PR (highest score across all categories)
                let overallBest = null;
                let maxScore = -1;

                let idx = 0;
                for (const category of ['Endurance', 'Volume', 'Force', 'Puissance']) {
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
 * @returns {string} "PR" if it is a personal record, "SB" if it is the same best, "NB" if it is the first time recording this exercise, null if it is not a personal record
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
        .select("unit value weightLoad elastic effectiveWeightLoad weightLoadLbs effectiveWeightLoadLbs date seance variations")
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
    unilateralSide = undefined
) {

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

    // Call the API to check if this set is a personal record
    try {
        // Check if this is the first time recording this exercise
        const allSets = await fetchPersonalRecordCandidateSets(
            userId,
            seanceId,
            unit,
            variations,
            isUnilateral,
            unilateralSide
        );

        if (allSets.length === 0) {
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
                    referenceBestSet: null
                }
            };
        }

        // Filter sets that are better or equal to the current set, when unit is the same
        let sets = allSets.filter(s => {
            if (unit && s.unit !== unit) return false;

            // ALL applicable attributes must be better or equal (AND logic, not OR)
            let isBetterOrEqual = true;

            // Check value - if current has value, previous must be >= 
            if (value != null && (s.value == null || s.value < value)) isBetterOrEqual = false;

            // Compare effective load (persisted kg ou weightLoad + élastique)
            if (s.weightLoad == null || getEffectiveLoadPreferringPersisted(s) < currentEffectiveLoad) isBetterOrEqual = false;

            return isBetterOrEqual;
        });

        // Check if the set is a personal record
        let status = null;
        if (sets.length === 0) {
            status = "PR";
        } else {
            // Find the best set from sets (highest value, then highest effective load)
            const bestSet = sets.reduce((best, current) => {
                if (current.value > best.value) return current;
                if (current.value === best.value && getEffectiveLoadPreferringPersisted(current) > getEffectiveLoadPreferringPersisted(best)) return current;
                return best;
            });

            // Check if the current set is the best set using values
            let isBestSet = true;
            if (value != null && bestSet.value != null && bestSet.value > value) isBestSet = false;
            if (getEffectiveLoadPreferringPersisted(bestSet) > currentEffectiveLoad) isBestSet = false;

            if (isBestSet === true) {
                status = "SB";
            }
        }

        const referenceBestSet = getReferenceBestSet(allSets, value, currentEffectiveLoad);
        const referenceEffectiveLoad = referenceBestSet ? getEffectiveLoadPreferringPersisted(referenceBestSet) : null;
        const referenceEffectiveLoadLbs = referenceBestSet ? getEffectiveLoadLbsPreferringPersisted(referenceBestSet) : null;
        const valueDelta = referenceBestSet && value != null && referenceBestSet.value != null
            ? value - referenceBestSet.value
            : null;
        const kgDelta = referenceBestSet && referenceEffectiveLoad != null
            ? round2(currentEffectiveLoad - referenceEffectiveLoad)
            : null;
        const lbsDelta = referenceBestSet && referenceEffectiveLoadLbs != null
            ? round2(currentEffectiveLoadLbs - referenceEffectiveLoadLbs)
            : null;

        return {
            isPersonalRecord: status,
            prDetail: {
                valueDelta,
                repsDelta: unit === 'repetitions' ? valueDelta : null,
                secondsDelta: unit === 'seconds' ? valueDelta : null,
                kgDelta,
                lbsDelta,
                effectiveLoadCurrent: round2(currentEffectiveLoad),
                effectiveLoadReference: referenceEffectiveLoad != null ? round2(referenceEffectiveLoad) : null,
                effectiveLoadCurrentLbs: currentEffectiveLoadLbs,
                effectiveLoadReferenceLbs: referenceEffectiveLoadLbs,
                referenceBestSet
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

function getReferenceBestSet(sets, currentValue, currentEffectiveLoad) {
    if (!sets.length) return null;
    const targetValue = Number.isFinite(Number(currentValue)) ? Number(currentValue) : 0;
    const targetLoad = Number.isFinite(Number(currentEffectiveLoad)) ? Number(currentEffectiveLoad) : 0;
    const bestSetsByRm = new Map();

    for (const set of sets) {
        const value = Number(set?.value);
        if (!Number.isFinite(value) || value <= 0) continue;

        const rmKey = Math.floor(value);
        if (rmKey < 1) continue;

        const currentBest = bestSetsByRm.get(rmKey);
        if (!currentBest) {
            bestSetsByRm.set(rmKey, set);
            continue;
        }

        const setLoad = getEffectiveLoadPreferringPersisted(set);
        const bestLoad = getEffectiveLoadPreferringPersisted(currentBest);

        if (setLoad > bestLoad) {
            bestSetsByRm.set(rmKey, set);
            continue;
        }
        if (setLoad === bestLoad && value > Number(currentBest?.value ?? 0)) {
            bestSetsByRm.set(rmKey, set);
        }
    }

    const candidateSets = Array.from(bestSetsByRm.values());
    if (!candidateSets.length) return null;

    return candidateSets.reduce((best, current) => {
        if (!best) return current;

        const bestValue = Number(best?.value ?? 0);
        const currentSetValue = Number(current?.value ?? 0);
        const bestLoad = getEffectiveLoadPreferringPersisted(best);
        const currentSetLoad = getEffectiveLoadPreferringPersisted(current);

        const bestDistance = Math.abs(targetValue - bestValue) + Math.abs(targetLoad - bestLoad);
        const currentDistance = Math.abs(targetValue - currentSetValue) + Math.abs(targetLoad - currentSetLoad);

        if (currentDistance < bestDistance) return current;
        if (currentDistance > bestDistance) return best;

        // Tie-break: prefer a "base" set not above current (gains non-négatifs si possible).
        const bestIsBase = bestValue <= targetValue && bestLoad <= targetLoad;
        const currentIsBase = currentSetValue <= targetValue && currentSetLoad <= targetLoad;
        if (currentIsBase && !bestIsBase) return current;
        if (!currentIsBase && bestIsBase) return best;

        // Final tie-break: keep the strongest nearby reference.
        if (currentSetValue > bestValue) return current;
        if (currentSetValue < bestValue) return best;
        if (currentSetLoad > bestLoad) return current;
        return best;
    }, null);
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
    unilateralSide = undefined
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
        unilateralSide
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
    resolveFamilySeedIds,
    buildVariationPrefixes,
    getSets,
    getTopExercices,
    createSet,
    getPRs,
    getDetailedPRs,
    getFigurePRs,
    getFigureDetailedPRs,
    getLastFormats,
    deleteSets,
    isPersonalRecord,
    isPersonalRecordWithDetail,
    getMyExercicesSearch,
    getMyExercicesAll,
    getPersonalRecordsSummary,
    getNormalizedProgressionTimeseries,
    getNormalFlowPerformedVariationFamilies
};

