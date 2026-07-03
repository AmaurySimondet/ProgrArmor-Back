const { getSets } = require('./set');
const Variation = require('../schema/variation');
const UserMeasure = require('../schema/userMeasure');
const {
    getDifficultyRatio,
    buildCanonicalVariationMap,
    resolveCanonicalVariationIdFromIds,
    toSortedSignature
} = require('./variationDifficultyGraph');
const {
    secondsToEquivalentReps,
    getEffectiveLoadKg,
    bestLastSetsOneRmEstimates,
    mapSetForRecommendationPeak,
} = require('../utils/oneRepMax');
const { whichWeight: { MAX_SESSION_SETS, MAX_BRZYCKI_TARGET_REPS, PEAK_RECENT_SETS_FOR_RECOMMENDATION } } = require('../constants');
const {
    resolveUserWeightKgForDate,
    resolveUserHeightMultiplierForDate,
} = require('../utils/userMeasureTimeline');
const { matchesSessionSetLateralFilter } = require('../utils/prSessionSets');

const WHICH_WEIGHT_LOG_PREFIX = '[whichweight]';

function logWhichWeight(message, meta = undefined) {
    if (meta === undefined) {
        console.log(`${WHICH_WEIGHT_LOG_PREFIX} ${message}`);
        return;
    }
    console.log(`${WHICH_WEIGHT_LOG_PREFIX} ${message}`, meta);
}

function buildTargetLoadInverseBreakdown(oneRmKg, targetUnit, targetValueRaw, weightedBodyweightKg = 0) {
    const rawTarget = Number(targetValueRaw);
    const repsEqTargetRaw = targetUnit === 'seconds'
        ? secondsToEquivalentReps(rawTarget)
        : rawTarget;
    const r = Number.isFinite(repsEqTargetRaw)
        ? Math.min(36, Math.max(1, repsEqTargetRaw))
        : null;
    const b = Number.isFinite(Number(weightedBodyweightKg)) ? Number(weightedBodyweightKg) : 0;
    const oneRm = Number(oneRmKg);
    let wEpley = null;
    let wBrzycki = null;
    if (Number.isFinite(r) && Number.isFinite(oneRm) && oneRm > 0) {
        const denom = 1 + r / 30;
        if (denom > 0) wEpley = (oneRm / denom) - b;
        if (r <= MAX_BRZYCKI_TARGET_REPS && r < 37) {
            const factor = (37 - r) / 36;
            wBrzycki = (oneRm * factor) - b;
        }
    }
    const candidates = [wEpley, wBrzycki].filter((v) => Number.isFinite(v));
    const avg = candidates.length
        ? candidates.reduce((sum, v) => sum + v, 0) / candidates.length
        : null;
    return {
        targetRepsEquivalent: r,
        weightedBodyweightKgSubtracted: b,
        wEpleyExternal: Number.isFinite(wEpley) ? Math.round(wEpley * 1000) / 1000 : null,
        wBrzyckiExternal: Number.isFinite(wBrzycki) ? Math.round(wBrzycki * 1000) / 1000 : null,
        brzyckiIncludedInInverse: Number.isFinite(wBrzycki),
        inverseAggregation: candidates.length > 1 ? 'average' : (candidates.length === 1 ? 'single_formula' : 'none'),
        averageBeforeRound: avg != null ? Math.round(avg * 1000) / 1000 : null,
        note: 'Charge utile 1RM (oneRmKg) ; inverse soustrait le PDC pondéré pour obtenir la charge externe.',
    };
}

function logWhichWeightLoadFormulaDiagnostics(meta = {}) {
    console.debug('[whichweight][load-formula]', {
        apiPath: 'whichweight',
        ...meta,
    });
}

function getRepsEquivalentFromSet(set) {
    if (!set) return null;
    if (set.unit === 'repetitions') return set.value ?? null;
    if (set.unit === 'seconds') return secondsToEquivalentReps(set.value);
    return null;
}

function toEffectiveLoadKg(set) {
    if (set && Number.isFinite(Number(set.effectiveWeightLoad))) {
        return Number(set.effectiveWeightLoad);
    }
    const load = getEffectiveLoadKg(set);
    return Number.isFinite(load) ? load : null;
}

function toFiniteOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function kgToLbsOrNull(valueKg) {
    const kg = Number(valueKg);
    if (!Number.isFinite(kg)) return null;
    return Math.round((kg * 2.2046226218) * 100) / 100;
}

function toRoundedKgOrNull(valueKg) {
    const kg = Number(valueKg);
    if (!Number.isFinite(kg)) return null;
    return Math.round(kg * 100) / 100;
}

function hasPositiveTotalEffectiveLoad(set) {
    const externalEff = toEffectiveLoadKg(set);
    if (!Number.isFinite(externalEff)) return false;
    const weightedBodyweightKg = Number.isFinite(Number(set?._weightedBodyweightKg))
        ? Number(set._weightedBodyweightKg)
        : 0;
    return (externalEff + weightedBodyweightKg) > 0;
}

function getVariationIdsFromPayload(variations) {
    if (!Array.isArray(variations)) return [];
    return variations
        .map((item) => (typeof item === 'string' ? item : item?.variation != null ? String(item.variation) : null))
        .filter(Boolean);
}

function toUniqueIdsPreservingOrder(ids) {
    const seen = new Set();
    const out = [];
    for (const id of Array.isArray(ids) ? ids : []) {
        const normalized = String(id);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function buildJoinedVariationName(names) {
    const frParts = [];
    const enParts = [];
    for (const name of Array.isArray(names) ? names : []) {
        if (typeof name === 'string') {
            const trimmed = name.trim();
            if (!trimmed) continue;
            frParts.push(trimmed);
            enParts.push(trimmed);
            continue;
        }
        if (!name || typeof name !== 'object') continue;
        const fr = typeof name.fr === 'string' ? name.fr.trim() : '';
        const en = typeof name.en === 'string' ? name.en.trim() : '';
        if (fr || en) {
            frParts.push(fr || en);
            enParts.push(en || fr);
        }
    }
    if (!frParts.length && !enParts.length) return null;
    return {
        fr: frParts.join(' '),
        en: enParts.join(' '),
    };
}

function getVariationIdsFromSet(set) {
    if (!set || !Array.isArray(set.variations)) return [];
    return set.variations.map((v) => (v?.variation != null ? String(v.variation) : null)).filter(Boolean);
}

function shouldIncludeBodyweightForVariationDocs(variationDocs) {
    if (!Array.isArray(variationDocs) || !variationDocs.length) return false;
    const exercises = variationDocs.filter((v) => v?.isExercice === true);
    if (!exercises.length) return false;
    return exercises.every((v) => v?.includeBodyweight === true);
}

function getExerciseBodyWeightRatioForVariationDocs(variationDocs) {
    if (!Array.isArray(variationDocs) || !variationDocs.length) return 1;
    const exercises = variationDocs.filter((v) => v?.isExercice === true);
    if (!exercises.length) return 1;
    const ratios = exercises
        .map((v) => Number(v?.exerciseBodyWeightRatio))
        .filter((r) => Number.isFinite(r) && r > 0);
    if (!ratios.length) return 1;
    return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

async function getShouldIncludeBodyweightForRequestVariations(variations) {
    const ids = getVariationIdsFromPayload(variations);
    if (!ids.length) return { includeBodyweight: false, exerciseBodyWeightRatio: 1 };
    const docs = await Variation.find(
        { _id: { $in: ids } },
        { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 }
    ).lean();
    return {
        includeBodyweight: shouldIncludeBodyweightForVariationDocs(docs),
        exerciseBodyWeightRatio: getExerciseBodyWeightRatioForVariationDocs(docs),
    };
}

async function getUserMeasuresByUser(userId) {
    return UserMeasure.find({ userId }, { measuredAt: 1, 'weight.kg': 1, heightMultiplier: 1 }).sort({ measuredAt: 1 }).lean();
}

function getVariationIdsFromSetForCanonical(set) {
    if (!set || !Array.isArray(set.variations)) return [];
    return set.variations
        .map((v) => (v?.variation != null ? String(v.variation) : null))
        .filter(Boolean);
}

function resolveCanonicalVariationIdForIds(ids, canonicalBySignature) {
    if (!ids.length) return null;
    const signature = toSortedSignature(ids);
    return canonicalBySignature.get(signature) || ids[0];
}

/**
 * Transforme les séries « en cours » (payload client) en objets compatibles
 * avec bestLastSetsOneRmEstimates (même forme que les sets issus de la base).
 * @param {unknown} sessionSets
 * @returns {Array<{ unit: string, value: number, weightLoad: number, elastic?: object|null, date: Date }>}
 */
function normalizeSessionSetsForEstimate(sessionSets, { isUnilateral = undefined, unilateralSide = undefined } = {}) {
    if (!Array.isArray(sessionSets) || sessionSets.length === 0) {
        return [];
    }

    const sliced = sessionSets.slice(0, MAX_SESSION_SETS);
    const baseMs = Date.now();

    const out = [];
    for (let i = 0; i < sliced.length; i += 1) {
        const raw = sliced[i];
        if (!raw || typeof raw !== 'object') continue;
        if (!matchesSessionSetLateralFilter(raw, { isUnilateral, unilateralSide })) continue;

        const unit = raw.unit;
        if (unit !== 'repetitions' && unit !== 'seconds') continue;

        const value = Number(raw.value);
        const weightLoad = raw.weightLoad != null ? Number(raw.weightLoad) : NaN;

        let elastic = null;
        if (raw.elastic && typeof raw.elastic === 'object') {
            const tension = raw.elastic.tension;
            elastic = {
                type: raw.elastic.type,
                use: raw.elastic.use,
                tension: tension != null && tension !== '' ? Number(tension) : null,
            };
        }

        const set = {
            unit,
            value: Number.isFinite(value) ? value : null,
            weightLoad: Number.isFinite(weightLoad) ? weightLoad : null,
            elastic,
            isUnilateral: raw.isUnilateral === true,
            unilateralSide: raw.unilateralSide,
            date: new Date(baseMs + i),
        };

        const repsEq = getRepsEquivalentFromSet(set);
        const eff = toEffectiveLoadKg(set);
        if (
            set.value == null
            || set.weightLoad == null
            || !Number.isFinite(repsEq)
            || repsEq <= 0
            || !Number.isFinite(eff)
        ) {
            continue;
        }

        out.push(set);
    }

    return out;
}

function computeTargetLoadFromOneRm(oneRmKg, targetUnit, targetValueRaw, weightedBodyweightKg = 0) {
    const rawTarget = Number(targetValueRaw);
    if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Valeur cible invalide / Invalid target value.'
        };
    }

    const repsEqTargetRaw = targetUnit === 'seconds'
        ? secondsToEquivalentReps(rawTarget)
        : rawTarget;

    if (!Number.isFinite(repsEqTargetRaw)) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une charge fiable avec les données actuelles.'
        };
    }

    const r = Math.min(36, Math.max(1, repsEqTargetRaw));

    const candidates = [];
    const b = Number.isFinite(Number(weightedBodyweightKg)) ? Number(weightedBodyweightKg) : 0;

    const denom = 1 + r / 30;
    if (denom > 0) {
        const wEpley = (oneRmKg / denom) - b;
        if (Number.isFinite(wEpley)) {
            candidates.push(wEpley);
        }
    }

    // Brzycki devient peu fiable sur reps élevées; pour garder la cohérence
    // (ex: 30 reps @ 0kg => recommandation proche de 0kg), on l'ignore > 15 reps.
    if (r <= MAX_BRZYCKI_TARGET_REPS && r < 37) {
        const factor = (37 - r) / 36;
        const wBrzycki = (oneRmKg * factor) - b;
        if (Number.isFinite(wBrzycki)) {
            candidates.push(wBrzycki);
        }
    }

    if (!candidates.length) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une charge fiable avec les données actuelles.'
        };
    }

    const avg = candidates.reduce((sum, v) => sum + v, 0) / candidates.length;
    const loadKg = Math.round(avg * 2) / 2;

    if (!Number.isFinite(loadKg)) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une charge fiable avec les données actuelles.'
        };
    }

    return { success: true, loadKg };
}

async function computeRecommendedLoad({
    userId,
    variations,
    targetUnit,
    targetValue,
    sessionSets,
    isUnilateral = undefined,
    unilateralSide = undefined,
}) {
    logWhichWeight('computeRecommendedLoad:start', {
        userId: userId ? String(userId) : null,
        variationsCount: Array.isArray(variations) ? variations.length : 0,
        targetUnit,
        targetValue,
        sessionSetsCount: Array.isArray(sessionSets) ? sessionSets.length : 0,
        isUnilateral,
        unilateralSide,
    });

    const requestVariationIds = toUniqueIdsPreservingOrder(getVariationIdsFromPayload(variations));
    const requestVariationDocs = requestVariationIds.length
        ? await Variation.find(
            { _id: { $in: requestVariationIds } },
            { name: 1, isExercice: 1 }
        ).lean()
        : [];
    const requestVariationById = new Map(
        requestVariationDocs.map((doc) => [String(doc?._id), doc || null])
    );
    const orderedTargetVariationIds = [
        ...requestVariationIds.filter((variationId) => requestVariationById.get(variationId)?.isExercice === true),
        ...requestVariationIds.filter((variationId) => requestVariationById.get(variationId)?.isExercice !== true),
    ];
    const targetVariations = orderedTargetVariationIds.map((variationId) => ({
        variationId,
        name: requestVariationById.get(variationId)?.name || null,
    }));
    const targetVariation = targetVariations.length
        ? {
            variationId: targetVariations[0].variationId,
            variationIds: orderedTargetVariationIds,
            name: buildJoinedVariationName(targetVariations.map((entry) => entry.name)),
        }
        : null;

    if (!userId || !Array.isArray(variations) || !variations.length) {
        logWhichWeight('computeRecommendedLoad:invalid-input', {
            hasUserId: Boolean(userId),
            hasVariations: Array.isArray(variations) && variations.length > 0,
        });
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Paramètres invalides / Invalid parameters.',
            targetVariation,
            targetVariations,
        };
    }

    if (targetUnit !== 'repetitions' && targetUnit !== 'seconds') {
        logWhichWeight('computeRecommendedLoad:invalid-target-unit', { targetUnit });
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Unité cible invalide / Invalid target unit.',
            targetVariation,
            targetVariations,
        };
    }

    const sets = await getSets(
        userId,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        variations,
        unilateralSide,
        isUnilateral
    );

    const requestPolicy = await getShouldIncludeBodyweightForRequestVariations(variations);
    const targetCanonicalVariationId = await resolveCanonicalVariationIdFromIds(requestVariationIds);
    const requestIncludesBodyweight = requestPolicy.includeBodyweight === true;
    const requestRatio = Number.isFinite(Number(requestPolicy.exerciseBodyWeightRatio))
        ? Number(requestPolicy.exerciseBodyWeightRatio)
        : 1;
    const userMeasures = requestIncludesBodyweight ? await getUserMeasuresByUser(userId) : [];
    const userWeightKg = resolveUserWeightKgForDate(userMeasures, new Date());
    const userWeightAvailable = Number.isFinite(Number(userWeightKg));
    logWhichWeight('computeRecommendedLoad:bodyweight-policy', {
        requestIncludesBodyweight,
        requestRatio,
        userMeasuresCount: userMeasures.length,
        userWeightKg: userWeightAvailable ? Number(userWeightKg) : null,
    });

    const allVariationGroups = [
        requestVariationIds,
        ...sets.map((set) => getVariationIdsFromSetForCanonical(set)),
        ...normalizeSessionSetsForEstimate(sessionSets, { isUnilateral, unilateralSide }).map((set) => getVariationIdsFromSet(set))
    ].filter((group) => Array.isArray(group) && group.length > 0);
    const canonicalBySignature = await buildCanonicalVariationMap(allVariationGroups);
    const targetHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, new Date());

    const buildSetForEstimate = async (set) => {
        const baseSet = set && typeof set.toObject === 'function' ? set.toObject() : set;
        const weightedBodyweightKg = requestIncludesBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * requestRatio
            : 0;

        const sourceVariationIds = getVariationIdsFromSetForCanonical(baseSet);
        const sourceCanonicalVariationId = resolveCanonicalVariationIdForIds(sourceVariationIds, canonicalBySignature);
        const sourceHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, baseSet?.date);
        let difficulty = { ratio: 1, path: [], hops: 0, confidenceScore: 1, reason: null };
        if (targetCanonicalVariationId && sourceCanonicalVariationId) {
            difficulty = await getDifficultyRatio({
                fromVariationId: sourceCanonicalVariationId,
                toVariationId: targetCanonicalVariationId
            });
        }
        const ratio = Number.isFinite(Number(difficulty?.ratio)) && Number(difficulty.ratio) > 0
            ? Number(difficulty.ratio)
            : 1;
        const conversionFactor = (1 / ratio) * (targetHeightMultiplier / sourceHeightMultiplier);

        return {
            ...baseSet,
            _weightedBodyweightKg: weightedBodyweightKg,
            _difficultyConversion: difficulty,
            _difficultyFactor: conversionFactor,
        };
    };

    const transformedSets = await Promise.all(sets.map(buildSetForEstimate));
    const usableSets = transformedSets
        .filter((s) => {
            if (!s) return false;
            if (s.value == null || s.weightLoad == null || !s.date) return false;
            if (s.unit !== 'repetitions' && s.unit !== 'seconds') return false;
            const repsEq = getRepsEquivalentFromSet(s);
            const eff = toEffectiveLoadKg(s);
            return Number.isFinite(repsEq) && repsEq > 0 && Number.isFinite(eff) && hasPositiveTotalEffectiveLoad(s);
        });

    const sessionNormalized = normalizeSessionSetsForEstimate(sessionSets, { isUnilateral, unilateralSide });
    const sessionUsable = await Promise.all(sessionNormalized.map(buildSetForEstimate));
    const combinedUsable = [...usableSets, ...sessionUsable];
    const usedSets = {
        fetchedHistoricalSets: Array.isArray(sets) ? sets.length : 0,
        usedHistoricalSets: usableSets.length,
        usedSessionSets: sessionUsable.length,
        usedTotalSets: combinedUsable.length,
    };
    logWhichWeight('computeRecommendedLoad:sets-usage', usedSets);

    if (!combinedUsable.length) {
        logWhichWeight('computeRecommendedLoad:no-usable-sets', {
            fetchedHistoricalSets: usedSets.fetchedHistoricalSets,
            usedSessionSets: usedSets.usedSessionSets,
        });
        return {
            success: false,
            reason: 'NO_DATA',
            message: 'Aucune série trouvée pour cet exercice, impossible de calculer une charge. / No sets found for this exercise, unable to compute a load.',
            userWeightUsed: requestIncludesBodyweight && userWeightAvailable,
            userWeightKg: userWeightAvailable ? Number(userWeightKg) : null,
            exerciseBodyWeightRatioUsed: requestIncludesBodyweight ? requestRatio : null,
            effectiveLoadIncludesBodyweight: requestIncludesBodyweight,
            effectiveLoadFormula: requestIncludesBodyweight
                ? 'effectiveLoadKg = weightLoad + signedElastic + (userWeightKg * exerciseBodyWeightRatio)'
                : 'effectiveLoadKg = weightLoad + signedElastic',
            usedSets,
            targetVariation,
            targetVariations,
        };
    }

    const setsForOneRm = combinedUsable.map((set) => mapSetForRecommendationPeak(set));
    const { oneRmKg, maxBrzycki, maxEpley } = bestLastSetsOneRmEstimates(
        setsForOneRm,
        PEAK_RECENT_SETS_FOR_RECOMMENDATION,
    );
    const weightedBodyweightKg = requestIncludesBodyweight && userWeightAvailable
        ? Number(userWeightKg) * requestRatio
        : 0;
    const peakEffectiveWeightLoadKg = toRoundedKgOrNull(Number(oneRmKg) - Number(weightedBodyweightKg));
    const strengthPeak = {
        oneRmKg,
        oneRmLbs: kgToLbsOrNull(oneRmKg),
        peakEffectiveWeightLoadKg,
        peakEffectiveWeightLoadLbs: kgToLbsOrNull(peakEffectiveWeightLoadKg),
        maxBrzycki,
        maxBrzyckiLbs: kgToLbsOrNull(maxBrzycki),
        maxEpley,
        maxEpleyLbs: kgToLbsOrNull(maxEpley),
    };
    logWhichWeight('computeRecommendedLoad:strength-peak', {
        oneRmKg,
        maxBrzycki: strengthPeak.maxBrzycki,
        maxEpley: strengthPeak.maxEpley,
        weightedBodyweightKg,
        peakEffectiveWeightLoadKg: strengthPeak.peakEffectiveWeightLoadKg,
    });

    if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) {
        logWhichWeight('computeRecommendedLoad:one-rm-unusable', { oneRmKg });
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une charge fiable avec les données actuelles.',
            userWeightUsed: requestIncludesBodyweight && userWeightAvailable,
            userWeightKg: userWeightAvailable ? Number(userWeightKg) : null,
            exerciseBodyWeightRatioUsed: requestIncludesBodyweight ? requestRatio : null,
            effectiveLoadIncludesBodyweight: requestIncludesBodyweight,
            effectiveLoadFormula: requestIncludesBodyweight
                ? 'effectiveLoadKg = weightLoad + signedElastic + (userWeightKg * exerciseBodyWeightRatio)'
                : 'effectiveLoadKg = weightLoad + signedElastic',
            strengthPeak,
            usedSets,
            targetVariation,
            targetVariations,
        };
    }

    const recommendation = computeTargetLoadFromOneRm(oneRmKg, targetUnit, targetValue, weightedBodyweightKg);
    const payload = {
        ...recommendation,
        userWeightUsed: requestIncludesBodyweight && userWeightAvailable,
        userWeightKg: userWeightAvailable ? Number(userWeightKg) : null,
        exerciseBodyWeightRatioUsed: requestIncludesBodyweight ? requestRatio : null,
        effectiveLoadIncludesBodyweight: requestIncludesBodyweight,
        effectiveLoadFormula: requestIncludesBodyweight
            ? 'effectiveLoadKg = weightLoad + signedElastic + (userWeightKg * exerciseBodyWeightRatio)'
            : 'effectiveLoadKg = weightLoad + signedElastic',
        strengthPeak,
        usedSets,
        difficultyConversion: {
            targetCanonicalVariationId,
            targetHeightMultiplier,
            mandatoryMorphology: true,
            graphEnabled: true
        },
        targetVariation,
        targetVariations,
    };
    if (recommendation?.success && requestIncludesBodyweight && userWeightAvailable) {
        payload.loadKgWithBodyweight = Math.round((recommendation.loadKg + weightedBodyweightKg) * 2) / 2;
    }
    logWhichWeightLoadFormulaDiagnostics({
        targetVariationId: targetVariation?.variationId ?? null,
        targetVariationName: targetVariation?.name ?? null,
        targetUnit,
        targetValue,
        oneRmKg,
        maxBrzycki: strengthPeak.maxBrzycki,
        maxEpley: strengthPeak.maxEpley,
        peakEffectiveWeightLoadKg: strengthPeak.peakEffectiveWeightLoadKg,
        requestIncludesBodyweight,
        exerciseBodyWeightRatioUsed: requestRatio,
        userWeightKg: userWeightAvailable ? Number(userWeightKg) : null,
        weightedBodyweightKg,
        usedSets,
        inverseBreakdown: buildTargetLoadInverseBreakdown(
            oneRmKg,
            targetUnit,
            targetValue,
            weightedBodyweightKg,
        ),
        recommendedLoadKg: payload.loadKg ?? null,
        recommendedLoadKgWithBodyweight: payload.loadKgWithBodyweight ?? null,
        profileStatsEquivalent: false,
        workoutLegacyPath: true,
    });
    logWhichWeight('computeRecommendedLoad:result', {
        success: payload.success === true,
        reason: payload.reason ?? null,
        loadKg: payload.loadKg ?? null,
        loadKgWithBodyweight: payload.loadKgWithBodyweight ?? null,
    });
    return payload;
}

/**
 * Pic 1RM charge utile à partir des seules séries de séance en cours (workout → figure path).
 */
async function estimateOneRmPeakFromSessionSets({
    userId,
    variations,
    sessionSets,
    isUnilateral = undefined,
    unilateralSide = undefined,
}) {
    const sessionNormalized = normalizeSessionSetsForEstimate(sessionSets, { isUnilateral, unilateralSide });
    if (!userId || !Array.isArray(variations) || !variations.length || !sessionNormalized.length) {
        return {
            oneRmKg: null,
            usedSessionSets: 0,
            strengthPeak: null,
        };
    }

    const requestVariationIds = toUniqueIdsPreservingOrder(getVariationIdsFromPayload(variations));
    const requestPolicy = await getShouldIncludeBodyweightForRequestVariations(variations);
    const targetCanonicalVariationId = await resolveCanonicalVariationIdFromIds(requestVariationIds);
    const requestIncludesBodyweight = requestPolicy.includeBodyweight === true;
    const requestRatio = Number.isFinite(Number(requestPolicy.exerciseBodyWeightRatio))
        ? Number(requestPolicy.exerciseBodyWeightRatio)
        : 1;
    const userMeasures = requestIncludesBodyweight ? await getUserMeasuresByUser(userId) : [];
    const userWeightKg = resolveUserWeightKgForDate(userMeasures, new Date());
    const allVariationGroups = [
        requestVariationIds,
        ...sessionNormalized.map((set) => getVariationIdsFromSet(set)),
    ].filter((group) => Array.isArray(group) && group.length > 0);
    const canonicalBySignature = await buildCanonicalVariationMap(allVariationGroups);
    const targetHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, new Date());

    const buildSetForEstimate = async (set) => {
        const baseSet = set && typeof set.toObject === 'function' ? set.toObject() : set;
        const weightedBodyweightKg = requestIncludesBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * requestRatio
            : 0;
        const sourceVariationIds = getVariationIdsFromSetForCanonical(baseSet);
        const sourceCanonicalVariationId = resolveCanonicalVariationIdForIds(sourceVariationIds, canonicalBySignature);
        const sourceHeightMultiplier = resolveUserHeightMultiplierForDate(userMeasures, baseSet?.date);
        let difficulty = { ratio: 1, path: [], hops: 0, confidenceScore: 1, reason: null };
        if (targetCanonicalVariationId && sourceCanonicalVariationId) {
            difficulty = await getDifficultyRatio({
                fromVariationId: sourceCanonicalVariationId,
                toVariationId: targetCanonicalVariationId,
            });
        }
        const ratio = Number.isFinite(Number(difficulty?.ratio)) && Number(difficulty.ratio) > 0
            ? Number(difficulty.ratio)
            : 1;
        const conversionFactor = (1 / ratio) * (targetHeightMultiplier / sourceHeightMultiplier);
        return {
            ...baseSet,
            _weightedBodyweightKg: weightedBodyweightKg,
            _difficultyConversion: difficulty,
            _difficultyFactor: conversionFactor,
        };
    };

    const sessionUsable = (await Promise.all(sessionNormalized.map(buildSetForEstimate)))
        .filter((s) => {
            if (!s) return false;
            if (s.value == null || s.weightLoad == null || !s.date) return false;
            if (s.unit !== 'repetitions' && s.unit !== 'seconds') return false;
            const repsEq = getRepsEquivalentFromSet(s);
            const eff = toEffectiveLoadKg(s);
            return Number.isFinite(repsEq) && repsEq > 0 && Number.isFinite(eff) && hasPositiveTotalEffectiveLoad(s);
        });

    if (!sessionUsable.length) {
        return {
            oneRmKg: null,
            usedSessionSets: 0,
            strengthPeak: null,
        };
    }

    const setsForOneRm = sessionUsable.map((set) => mapSetForRecommendationPeak(set));
    const { oneRmKg, maxBrzycki, maxEpley } = bestLastSetsOneRmEstimates(
        setsForOneRm,
        PEAK_RECENT_SETS_FOR_RECOMMENDATION,
    );
    const weightedBodyweightKg = requestIncludesBodyweight && Number.isFinite(Number(userWeightKg))
        ? Number(userWeightKg) * requestRatio
        : 0;
    const peakEffectiveWeightLoadKg = toRoundedKgOrNull(Number(oneRmKg) - Number(weightedBodyweightKg));

    return {
        oneRmKg: Number.isFinite(oneRmKg) && oneRmKg > 0 ? oneRmKg : null,
        usedSessionSets: sessionUsable.length,
        strengthPeak: Number.isFinite(oneRmKg) && oneRmKg > 0
            ? {
                oneRmKg,
                peakEffectiveWeightLoadKg,
                maxBrzycki,
                maxEpley,
                rmKey: 'SESSION',
            }
            : null,
    };
}

module.exports = {
    computeTargetLoadFromOneRm,
    computeRecommendedLoad,
    estimateOneRmPeakFromSessionSets,
};

