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
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley,
    getEffectiveLoadKg,
} = require('../utils/oneRepMax');
const { whichWeight: { MAX_SESSION_SETS, MAX_BRZYCKI_TARGET_REPS } } = require('../constants');

const WHICH_WEIGHT_LOG_PREFIX = '[whichweight]';

function logWhichWeight(message, meta = undefined) {
    if (meta === undefined) {
        console.log(`${WHICH_WEIGHT_LOG_PREFIX} ${message}`);
        return;
    }
    console.log(`${WHICH_WEIGHT_LOG_PREFIX} ${message}`, meta);
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
    const kg = chosen?.weight?.kg;
    return Number.isFinite(Number(kg)) ? Number(kg) : null;
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
function normalizeSessionSetsForEstimate(sessionSets) {
    if (!Array.isArray(sessionSets) || sessionSets.length === 0) {
        return [];
    }

    const sliced = sessionSets.slice(0, MAX_SESSION_SETS);
    const baseMs = Date.now();

    const out = [];
    for (let i = 0; i < sliced.length; i += 1) {
        const raw = sliced[i];
        if (!raw || typeof raw !== 'object') continue;

        const unit = raw.unit;
        if (unit !== 'repetitions' && unit !== 'seconds') continue;

        const value = Number(raw.value);
        const weightLoad = raw.weightLoad != null ? Number(raw.weightLoad) : NaN;

        let elastic = null;
        if (raw.elastic && typeof raw.elastic === 'object') {
            const tension = raw.elastic.tension;
            elastic = {
                use: raw.elastic.use,
                tension: tension != null && tension !== '' ? Number(tension) : null,
            };
        }

        const set = {
            unit,
            value: Number.isFinite(value) ? value : null,
            weightLoad: Number.isFinite(weightLoad) ? weightLoad : null,
            elastic,
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

function bestLastSetsOneRmEstimates(sets, maxSets = 10) {
    if (!Array.isArray(sets) || sets.length === 0) {
        return { oneRmKg: null, maxBrzycki: null, maxEpley: null };
    }

    const sorted = [...sets].sort((a, b) => new Date(a.date) - new Date(b.date));
    const recent = sorted.slice(-maxSets);

    let maxBrzycki = null;
    let maxEpley = null;

    for (const set of recent) {
        const repsEq = getRepsEquivalentFromSet(set);
        const effLoad = toEffectiveLoadKg(set);

        if (!Number.isFinite(repsEq) || !Number.isFinite(effLoad) || !hasPositiveTotalEffectiveLoad(set)) {
            continue;
        }

        const brzyckiEff = set.brzycki ?? estimateOneRepMaxBrzycki(effLoad, repsEq);
        const epleyEff = set.epley ?? estimateOneRepMaxEpley(effLoad, repsEq);

        if (Number.isFinite(brzyckiEff) && brzyckiEff > 0) {
            if (maxBrzycki == null || brzyckiEff > maxBrzycki) {
                maxBrzycki = brzyckiEff;
            }
        }
        if (Number.isFinite(epleyEff) && epleyEff > 0) {
            if (maxEpley == null || epleyEff > maxEpley) {
                maxEpley = epleyEff;
            }
        }
    }

    let oneRmKg = null;
    if (maxBrzycki != null && maxEpley != null) {
        oneRmKg = (maxBrzycki + maxEpley) / 2;
    } else if (maxBrzycki != null) {
        oneRmKg = maxBrzycki;
    } else if (maxEpley != null) {
        oneRmKg = maxEpley;
    }

    if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) {
        oneRmKg = null;
    }

    return { oneRmKg, maxBrzycki, maxEpley };
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
    maxSets = 10,
    sessionSets,
    isUnilateral = undefined,
    unilateralSide = undefined,
}) {
    logWhichWeight('computeRecommendedLoad:start', {
        userId: userId ? String(userId) : null,
        variationsCount: Array.isArray(variations) ? variations.length : 0,
        targetUnit,
        targetValue,
        maxSets,
        sessionSetsCount: Array.isArray(sessionSets) ? sessionSets.length : 0,
        isUnilateral,
        unilateralSide,
    });

    if (!userId || !Array.isArray(variations) || !variations.length) {
        logWhichWeight('computeRecommendedLoad:invalid-input', {
            hasUserId: Boolean(userId),
            hasVariations: Array.isArray(variations) && variations.length > 0,
        });
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Paramètres invalides / Invalid parameters.'
        };
    }

    if (targetUnit !== 'repetitions' && targetUnit !== 'seconds') {
        logWhichWeight('computeRecommendedLoad:invalid-target-unit', { targetUnit });
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Unité cible invalide / Invalid target unit.'
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
    const requestVariationIds = getVariationIdsFromPayload(variations);
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
        ...normalizeSessionSetsForEstimate(sessionSets).map((set) => getVariationIdsFromSet(set))
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

    const sessionNormalized = normalizeSessionSetsForEstimate(sessionSets);
    const sessionUsable = await Promise.all(sessionNormalized.map(buildSetForEstimate));
    const combinedUsable = [...usableSets, ...sessionUsable];
    const usedSets = {
        fetchedHistoricalSets: Array.isArray(sets) ? sets.length : 0,
        usedHistoricalSets: usableSets.length,
        usedSessionSets: sessionUsable.length,
        usedTotalSets: combinedUsable.length,
        maxSetsRequested: Number(maxSets),
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
        };
    }

    const setsForOneRm = combinedUsable.map((set) => {
        const w = Number(set._weightedBodyweightKg || 0);
        const b = toFiniteOrNull(set.brzyckiWithBodyweight);
        const e = toFiniteOrNull(set.epleyWithBodyweight);
        const brzycki = toFiniteOrNull(set.brzycki) ?? (b != null ? b - w : null);
        const epley = toFiniteOrNull(set.epley) ?? (e != null ? e - w : null);
        const externalEff = toEffectiveLoadKg(set);
        const totalEff = Number.isFinite(externalEff) ? externalEff + w : null;
        const conversionFactor = Number.isFinite(Number(set._difficultyFactor)) && Number(set._difficultyFactor) > 0
            ? Number(set._difficultyFactor)
            : 1;
        const convertedEff = Number.isFinite(totalEff) ? totalEff * conversionFactor : null;
        return {
            ...set,
            brzycki: null,
            epley: null,
            effectiveWeightLoad: Number.isFinite(convertedEff) ? convertedEff : set.effectiveWeightLoad,
        };
    });
    const { oneRmKg, maxBrzycki, maxEpley } = bestLastSetsOneRmEstimates(setsForOneRm, maxSets);

    const weightedBodyweightKg = requestIncludesBodyweight && userWeightAvailable
        ? Number(userWeightKg) * requestRatio
        : 0;
    const peakEffectiveWeightLoadKg = toRoundedKgOrNull(
        Number(oneRmKg) - Number(weightedBodyweightKg)
    );
    logWhichWeight('computeRecommendedLoad:strength-peak', {
        oneRmKg,
        maxBrzycki,
        maxEpley,
        weightedBodyweightKg,
        peakEffectiveWeightLoadKg,
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
            strengthPeak: {
                oneRmKg,
                oneRmLbs: kgToLbsOrNull(oneRmKg),
                peakEffectiveWeightLoadKg,
                maxBrzycki,
                maxBrzyckiLbs: kgToLbsOrNull(maxBrzycki),
                maxEpley,
                maxEpleyLbs: kgToLbsOrNull(maxEpley),
            },
            usedSets,
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
        strengthPeak: {
            oneRmKg,
            oneRmLbs: kgToLbsOrNull(oneRmKg),
            peakEffectiveWeightLoadKg,
            maxBrzycki,
            maxBrzyckiLbs: kgToLbsOrNull(maxBrzycki),
            maxEpley,
            maxEpleyLbs: kgToLbsOrNull(maxEpley),
        },
        usedSets,
        difficultyConversion: {
            targetCanonicalVariationId,
            targetHeightMultiplier,
            mandatoryMorphology: true,
            graphEnabled: true
        }
    };
    if (recommendation?.success && requestIncludesBodyweight && userWeightAvailable) {
        payload.loadKgWithBodyweight = Math.round((recommendation.loadKg + weightedBodyweightKg) * 2) / 2;
    }
    logWhichWeight('computeRecommendedLoad:result', {
        success: payload.success === true,
        reason: payload.reason ?? null,
        loadKg: payload.loadKg ?? null,
        loadKgWithBodyweight: payload.loadKgWithBodyweight ?? null,
    });
    return payload;
}

module.exports = {
    bestLastSetsOneRmEstimates,
    computeTargetLoadFromOneRm,
    computeRecommendedLoad,
};

