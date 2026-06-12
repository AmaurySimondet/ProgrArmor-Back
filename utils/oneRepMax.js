/**
 * Estimations 1RM Brzycki / Epley — même logique que l'app mobile (utils/oneRepMax.js).
 * @see https://en.wikipedia.org/wiki/One-repetition_maximum
 */

const { whichWeight: { MAX_BRZYCKI_TARGET_REPS } } = require('../constants');

const toFiniteNumber = (value, fallback = 0) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/** @param {{ use?: string, tension?: number|null }} elastic */
const getSignedElasticTensionKg = (elastic) => {
    if (!elastic || elastic.tension === null || elastic.tension === undefined) return 0;
    const tension = toFiniteNumber(elastic.tension, 0);
    if (tension === 0) return 0;
    return elastic.use === 'assistance' ? -tension : tension;
};

/** @param {{ weightLoad?: number|null, elastic?: object|null }} set */
const getExternalEffectiveLoadKg = (set) => {
    const w = toFiniteNumber(set?.weightLoad, 0);
    return w + getSignedElasticTensionKg(set?.elastic);
};

/**
 * @param {{ weightLoad?: number|null, elastic?: object|null, effectiveWeightLoad?: number|null }} set
 * @param {{ includeBodyweight?: boolean, userWeightKg?: number|null|undefined }} [options]
 */
const getEffectiveLoadKg = (set, options = {}) => {
    if (set && Number.isFinite(Number(set.effectiveWeightLoad))) {
        return Number(set.effectiveWeightLoad);
    }
    const externalLoad = getExternalEffectiveLoadKg(set);
    const includeBodyweight = options?.includeBodyweight === true;
    if (!includeBodyweight) {
        return externalLoad;
    }
    const userWeightKg = toFiniteNumber(options?.userWeightKg, 0);
    return externalLoad + userWeightKg;
};

const SECONDS_TO_REPS_KNOTS = [
    [0, 0],
    [3, 1],
    [10, 3],
    [30, 7],
    [60, 13.5],
];

const piecewiseLinearSecondsToReps = (seconds) => {
    const s = Math.max(0, toFiniteNumber(seconds, 0));
    const knots = SECONDS_TO_REPS_KNOTS;
    if (s <= knots[0][0]) return knots[0][1];

    for (let i = 0; i < knots.length - 1; i += 1) {
        const [x0, y0] = knots[i];
        const [x1, y1] = knots[i + 1];
        if (s <= x1) {
            if (x1 === x0) return y1;
            const t = (s - x0) / (x1 - x0);
            return y0 + t * (y1 - y0);
        }
    }

    const n = knots.length;
    const [xPrev, yPrev] = knots[n - 2];
    const [xLast, yLast] = knots[n - 1];
    const slope = (yLast - yPrev) / (xLast - xPrev);
    return yLast + (s - xLast) * slope;
};

const secondsToEquivalentReps = (seconds) => piecewiseLinearSecondsToReps(seconds);

/** @param {{ unit?: string, value?: number|null, repsEquivalent?: number|null }} set */
const getTrainingRepsEquivalent = (set) => {
    if (set?.unit === 'cardio') {
        return null;
    }
    if (Number.isFinite(Number(set?.repsEquivalent))) {
        return Number(set.repsEquivalent);
    }
    const v = toFiniteNumber(set?.value, 0);
    if (set?.unit === 'seconds') {
        return secondsToEquivalentReps(v);
    }
    return v;
};

const clampRepsForOneRmFormulas = (reps) => {
    const r = toFiniteNumber(reps, 0);
    if (r <= 0) return null;
    return Math.min(Math.max(r, 1), 36);
};

const shouldUseBrzyckiForRepsEquivalent = (reps) => {
    const r = clampRepsForOneRmFormulas(reps);
    if (r === null) return false;
    return r < MAX_BRZYCKI_TARGET_REPS;
};

/**
 * Reps équivalentes via l'inverse Brzycki pour un 1RM et une charge effective.
 */
function invertBrzyckiRepsFromOneRm(oneRmKg, effectiveLoadKg) {
    const oneRm = Number(oneRmKg);
    const load = Number(effectiveLoadKg);
    if (!Number.isFinite(oneRm) || oneRm <= 0 || !Number.isFinite(load) || load <= 0) return null;
    return 37 - ((36 * load) / oneRm);
}

/**
 * Brzycki utilisable dans une agrégation forward si reps source < seuil
 * et inverse Brzycki à la charge d'évaluation < seuil.
 */
function shouldIncludeBrzyckiInOneRmAggregate({
    repsEquivalent = null,
    oneRmCandidateKg = null,
    effectiveLoadKg = null,
} = {}) {
    if (!shouldUseBrzyckiForRepsEquivalent(repsEquivalent)) return false;
    const oneRm = Number(oneRmCandidateKg);
    const load = Number(effectiveLoadKg);
    if (!Number.isFinite(oneRm) || oneRm <= 0) return false;
    if (!Number.isFinite(load) || load <= 0) return true;
    const rBrzycki = invertBrzyckiRepsFromOneRm(oneRm, load);
    return Number.isFinite(rBrzycki) && rBrzycki < MAX_BRZYCKI_TARGET_REPS;
}

/**
 * Reps (équivalent) depuis un 1RM et une charge effective totale.
 * Brzycki ignoré si l'inverse dépasserait MAX_BRZYCKI_TARGET_REPS.
 */
function computeTargetRepsEquivalentFromOneRm(oneRmKg, effectiveLoadKg) {
    const oneRm = Number(oneRmKg);
    const load = Number(effectiveLoadKg);
    if (!Number.isFinite(oneRm) || oneRm <= 0 || !Number.isFinite(load) || load <= 0) return null;

    const candidates = [];
    const rBrzycki = invertBrzyckiRepsFromOneRm(oneRm, load);
    if (Number.isFinite(rBrzycki) && rBrzycki < MAX_BRZYCKI_TARGET_REPS) {
        candidates.push(rBrzycki);
    }
    const rEpley = 30 * ((oneRm / load) - 1);
    if (Number.isFinite(rEpley)) candidates.push(rEpley);
    if (!candidates.length) return null;
    return Math.min(36, Math.max(1, candidates.reduce((sum, v) => sum + v, 0) / candidates.length));
}

const isHighRepEquivalentSet = (set) =>
    getTrainingRepsEquivalent(set) >= MAX_BRZYCKI_TARGET_REPS;

const estimateOneRepMaxBrzycki = (weightKg, reps) => {
    const w = toFiniteNumber(weightKg, 0);
    const r = clampRepsForOneRmFormulas(reps);
    if (r === null || w <= 0) return null;
    return (w * 36) / (37 - r);
};

const estimateOneRepMaxEpley = (weightKg, reps) => {
    const w = toFiniteNumber(weightKg, 0);
    const r = clampRepsForOneRmFormulas(reps);
    if (r === null || w <= 0) return null;
    if (r <= 1) return w;
    return w * (1 + r / 30);
};

const roundKg = (value) => {
    if (value === null || !Number.isFinite(value)) return null;
    return Math.round(value * 100) / 100;
};

const readStoredEstimate = (value) =>
    (typeof value === 'number' && Number.isFinite(value) ? value : null);

const getLoadKgForEstimate = (set) => {
    if (Number.isFinite(Number(set?.effectiveWeightLoad))) {
        return Number(set.effectiveWeightLoad);
    }
    return getEffectiveLoadKg(set);
};

/**
 * @param {{ unit?: string, value?: number|null, weightLoad?: number|null, elastic?: object|null, effectiveWeightLoad?: number|null }} set
 */
function computeSetOneRepMaxEstimates(set) {
    const repsEq = getTrainingRepsEquivalent(set);
    const w = getLoadKgForEstimate(set);
    const brzycki = shouldUseBrzyckiForRepsEquivalent(repsEq)
        ? roundKg(estimateOneRepMaxBrzycki(w, repsEq))
        : null;
    return {
        brzycki,
        epley: roundKg(estimateOneRepMaxEpley(w, repsEq)),
    };
}

/**
 * 1RM Brzycki en charge utile (champ persisté `brzycki`, pas le total avec poids du corps).
 */
function resolveChargeUtileBrzyckiKg(set) {
    if (isHighRepEquivalentSet(set)) return null;
    const external = readStoredEstimate(set?.brzycki);
    if (external != null) return external;
    const withBw = readStoredEstimate(set?.brzyckiWithBodyweight);
    if (withBw == null) return null;
    const uw = Number(set?.oneRepMaxUserWeightKg);
    const ratio = Number(set?.oneRepMaxExerciseBodyWeightRatio);
    const w = Number.isFinite(uw) && Number.isFinite(ratio) ? uw * ratio : Number(set?._weightedBodyweightKg || 0);
    if (Number.isFinite(w) && w > 0) return roundKg(withBw - w);
    return withBw;
}

/**
 * 1RM Epley en charge utile.
 */
function resolveChargeUtileEpleyKg(set) {
    const external = readStoredEstimate(set?.epley);
    if (external != null) return external;
    const withBw = readStoredEstimate(set?.epleyWithBodyweight);
    if (withBw == null) return null;
    const uw = Number(set?.oneRepMaxUserWeightKg);
    const ratio = Number(set?.oneRepMaxExerciseBodyWeightRatio);
    const w = Number.isFinite(uw) && Number.isFinite(ratio) ? uw * ratio : Number(set?._weightedBodyweightKg || 0);
    if (Number.isFinite(w) && w > 0) return roundKg(withBw - w);
    return withBw;
}

function resolveBrzyckiEstimateKg(set) {
    const chargeUtile = resolveChargeUtileBrzyckiKg(set);
    if (chargeUtile != null) return chargeUtile;
    return computeSetOneRepMaxEstimates({
        ...set,
        effectiveWeightLoad: getExternalEffectiveLoadKg(set),
    }).brzycki;
}

function resolveEpleyEstimateKg(set) {
    const chargeUtile = resolveChargeUtileEpleyKg(set);
    if (chargeUtile != null) return chargeUtile;
    return computeSetOneRepMaxEstimates({
        ...set,
        effectiveWeightLoad: getExternalEffectiveLoadKg(set),
    }).epley;
}

function resolvePeakOneRmReferenceKg(set) {
    return isHighRepEquivalentSet(set) ? resolveEpleyEstimateKg(set) : resolveBrzyckiEstimateKg(set);
}

/** Série avec au moins 1 rep ou des secondes > 0 (hors séries « 0 rep / 0 sec »). */
function hasPositiveTrainingVolume(set) {
    const repsEq = getTrainingRepsEquivalent(set);
    return Number.isFinite(repsEq) && repsEq > 0;
}

/**
 * Prépare brzycki/epley pour la comparaison de pic (estimations persistées, BW inclus si besoin).
 * @param {object} set
 * @param {{ includeBodyweight?: boolean, weightedBodyweightKg?: number, difficultyFactor?: number }} [options]
 */
function mapSetWithPeakOneRmEstimates(set, options = {}) {
    const includeBodyweight = options.includeBodyweight === true;
    const weightedBodyweightKg = Number(options.weightedBodyweightKg || 0);
    const useStoredEstimatesOnly = options.useStoredEstimatesOnly === true;
    const factor = Number.isFinite(Number(options.difficultyFactor)) && Number(options.difficultyFactor) > 0
        ? Number(options.difficultyFactor)
        : 1;
    const scale = (value) => (value != null && Number.isFinite(value) ? roundKg(value * factor) : null);

    let brzycki = null;
    let epley = null;

    if (useStoredEstimatesOnly) {
        brzycki = resolveChargeUtileBrzyckiKg(set);
        epley = resolveChargeUtileEpleyKg(set);
    } else {
        brzycki = resolveChargeUtileBrzyckiKg(set);
        epley = resolveChargeUtileEpleyKg(set);
        if (brzycki == null && includeBodyweight && weightedBodyweightKg > 0) {
            const withBw = readStoredEstimate(set?.brzyckiWithBodyweight);
            if (withBw != null) brzycki = roundKg(withBw - weightedBodyweightKg);
        }
        if (epley == null && includeBodyweight && weightedBodyweightKg > 0) {
            const withBw = readStoredEstimate(set?.epleyWithBodyweight);
            if (withBw != null) epley = roundKg(withBw - weightedBodyweightKg);
        }
    }

    if (brzycki == null && epley == null) {
        const loadKg = Number.isFinite(Number(set?.effectiveWeightLoad))
            ? Number(set.effectiveWeightLoad)
            : getExternalEffectiveLoadKg(set);
        const estimates = computeSetOneRepMaxEstimates({
            ...set,
            effectiveWeightLoad: loadKg,
        });
        brzycki = estimates.brzycki;
        epley = estimates.epley;
    }

    return {
        ...set,
        brzycki: scale(brzycki),
        epley: scale(epley),
    };
}

/**
 * Pic recommandation charge/valeur : max Brzycki et max Epley séparés sur les N derniers sets (charge utile).
 * @param {Array<object>} sets
 * @param {number} [maxSets]
 */
function bestLastSetsOneRmEstimates(sets, maxSets = 10) {
    if (!Array.isArray(sets) || sets.length === 0) {
        return { oneRmKg: null, maxBrzycki: null, maxEpley: null };
    }

    const sorted = [...sets]
        .filter((e) => e?.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    const recent = typeof maxSets === 'number' && Number.isFinite(maxSets) && maxSets > 0
        ? sorted.slice(-Math.min(maxSets, sorted.length))
        : sorted;

    let maxBrzycki = null;
    let maxEpley = null;

    for (const set of recent) {
        const repsEq = getTrainingRepsEquivalent(set);
        if (!Number.isFinite(repsEq) || repsEq <= 0) continue;

        const brzyckiEff = !isHighRepEquivalentSet(set) ? resolveBrzyckiEstimateKg(set) : null;
        const epleyEff = resolveEpleyEstimateKg(set);

        if (Number.isFinite(brzyckiEff) && brzyckiEff > 0) {
            if (maxBrzycki == null || brzyckiEff > maxBrzycki) maxBrzycki = brzyckiEff;
        }
        if (Number.isFinite(epleyEff) && epleyEff > 0) {
            if (maxEpley == null || epleyEff > maxEpley) maxEpley = epleyEff;
        }
    }

    let oneRmKg = null;
    if (maxBrzycki != null && maxEpley != null) oneRmKg = (maxBrzycki + maxEpley) / 2;
    else if (maxBrzycki != null) oneRmKg = maxBrzycki;
    else if (maxEpley != null) oneRmKg = maxEpley;

    if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) oneRmKg = null;

    return {
        oneRmKg: oneRmKg != null ? roundKg(oneRmKg) : null,
        maxBrzycki: maxBrzycki != null ? roundKg(maxBrzycki) : null,
        maxEpley: maxEpley != null ? roundKg(maxEpley) : null,
    };
}

/**
 * Prépare un set pour le pic whichweight/whichvalue (charge utile × facteur difficulté).
 */
function mapSetForRecommendationPeak(set) {
    const w = Number(set?._weightedBodyweightKg || 0);
    const conversionFactor = Number.isFinite(Number(set._difficultyFactor)) && Number(set._difficultyFactor) > 0
        ? Number(set._difficultyFactor)
        : 1;
    const brzyckiBase = resolveChargeUtileBrzyckiKg(set);
    const epleyBase = resolveChargeUtileEpleyKg(set);
    const externalEff = getExternalEffectiveLoadKg(set);
    const convertedExternal = Number.isFinite(externalEff)
        ? roundKg(externalEff * conversionFactor)
        : null;

    return {
        ...set,
        brzycki: brzyckiBase != null ? roundKg(brzyckiBase * conversionFactor) : null,
        epley: epleyBase != null ? roundKg(epleyBase * conversionFactor) : null,
        effectiveWeightLoad: convertedExternal,
        oneRepMaxIncludesBodyweight: false,
        _weightedBodyweightKg: w,
    };
}

/**
 * Meilleur 1RM sur la plage (ou les N derniers sets si limit est défini) — même série source Brzycki/Epley.
 * @param {Array<object>} sets
 * @param {number} [limit] — si défini, ne garde que les N derniers sets chronologiques
 */
function bestLastSetsOneRmFromSameSourceSet(sets, limit) {
    if (!Array.isArray(sets) || sets.length === 0) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    const sorted = [...sets]
        .filter((e) => e?.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sorted.length === 0) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    const useRecentWindow = typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
    const slice = useRecentWindow
        ? sorted.slice(-Math.min(limit, sorted.length))
        : sorted;
    const bestEntry = slice.reduce((acc, setData) => {
        const candidate = resolvePeakOneRmReferenceKg(setData);
        if (!Number.isFinite(candidate) || candidate <= 0) return acc;
        if (!acc || candidate > acc.reference) {
            return { sourceSet: setData, reference: candidate };
        }
        return acc;
    }, null);
    if (!bestEntry?.sourceSet || !Number.isFinite(bestEntry.reference)) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    return {
        brzycki: roundKg(resolveBrzyckiEstimateKg(bestEntry.sourceSet)),
        epley: roundKg(resolveEpleyEstimateKg(bestEntry.sourceSet)),
        reference: roundKg(bestEntry.reference),
        sourceSet: bestEntry.sourceSet,
    };
}

/**
 * Premier set chronologique de la plage (date range complète).
 * @param {Array<object>} sets
 */
function firstSetOneRmFromRange(sets) {
    if (!Array.isArray(sets) || sets.length === 0) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    const sorted = [...sets]
        .filter((e) => e?.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    const first = sorted[0];
    if (!first) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    const reference = resolvePeakOneRmReferenceKg(first);
    if (!Number.isFinite(reference)) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    return {
        brzycki: roundKg(resolveBrzyckiEstimateKg(first)),
        epley: roundKg(resolveEpleyEstimateKg(first)),
        reference: roundKg(reference),
        sourceSet: first,
    };
}

/**
 * Progression pic vs début de période. Null si non mesurable (références ≤ 0 ou pic ≤ premier).
 */
function computePercentageFromStart(peakReferenceKg, firstReferenceKg) {
    const peak = Number(peakReferenceKg);
    const first = Number(firstReferenceKg);
    if (!Number.isFinite(peak) || !Number.isFinite(first) || first <= 0 || peak <= 0) {
        return null;
    }
    if (peak <= first) {
        return null;
    }
    return Math.round(((peak - first) / first) * 1000) / 10;
}

/**
 * Agrège Brzycki + Epley pour un 1RM normalisé.
 * Brzycki ignoré si reps >= MAX_BRZYCKI_TARGET_REPS ou si son inverse à effectiveLoadKg >= seuil.
 */
function resolveAggregateNormalizedOneRm(
    normalizedBrzycki,
    normalizedEpley,
    repsEquivalent,
    effectiveLoadKg = null,
) {
    if (!shouldUseBrzyckiForRepsEquivalent(repsEquivalent)) {
        return normalizedEpley != null ? roundKg(normalizedEpley) : null;
    }
    if (normalizedBrzycki != null && normalizedEpley != null) {
        const average = roundKg((normalizedBrzycki + normalizedEpley) / 2);
        if (shouldIncludeBrzyckiInOneRmAggregate({
            repsEquivalent,
            oneRmCandidateKg: average,
            effectiveLoadKg,
        })) {
            return average;
        }
        return roundKg(normalizedEpley);
    }
    return normalizedBrzycki ?? normalizedEpley ?? null;
}

/**
 * 1RM normalisé pour recommandation figure (charge totale avec PDC si applicable).
 * Brzycki ignoré à partir de MAX_BRZYCKI_TARGET_REPS — aligné sur l'inverse whichfigure/whichvalue.
 */
function resolveNormalizedOneRmForRecommendation({
    normalizedOneRm = null,
    brzyckiWithBodyweight = null,
    epleyWithBodyweight = null,
    normalizedBrzycki = null,
    normalizedEpley = null,
    weightedBodyweightKg = 0,
    repsEquivalent = null,
    difficultyFactor = 1,
    includeBodyweight = false,
    externalEffectiveLoadKg = null,
    effectiveLoadKgForBrzyckiCheck = null,
}) {
    const factor = Number.isFinite(Number(difficultyFactor)) && Number(difficultyFactor) > 0
        ? Number(difficultyFactor)
        : 1;
    const scale = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? roundKg(n * factor) : null;
    };
    const weightedBw = Number(weightedBodyweightKg);
    const externalLoad = Number(externalEffectiveLoadKg);
    const effectiveLoadKg = Number.isFinite(Number(effectiveLoadKgForBrzyckiCheck))
        ? Number(effectiveLoadKgForBrzyckiCheck)
        : ((Number.isFinite(externalLoad) ? externalLoad : 0)
            + (Number.isFinite(weightedBw) && weightedBw > 0 ? weightedBw : 0));

    if (!includeBodyweight || !(Number.isFinite(weightedBw) && weightedBw > 0)) {
        return resolveAggregateNormalizedOneRm(
            normalizedBrzycki,
            normalizedEpley ?? normalizedOneRm,
            repsEquivalent,
            effectiveLoadKg > 0 ? effectiveLoadKg : null,
        ) ?? normalizedOneRm;
    }

    const normBrzyckiBw = shouldUseBrzyckiForRepsEquivalent(repsEquivalent)
        ? scale(brzyckiWithBodyweight)
        : null;
    const normEpleyBw = scale(epleyWithBodyweight);

    if (normBrzyckiBw != null && normEpleyBw != null) {
        const average = roundKg((normBrzyckiBw + normEpleyBw) / 2);
        if (shouldIncludeBrzyckiInOneRmAggregate({
            repsEquivalent,
            oneRmCandidateKg: average,
            effectiveLoadKg,
        })) {
            return average;
        }
        return normEpleyBw;
    }
    if (normEpleyBw != null) {
        return normEpleyBw;
    }
    if (normBrzyckiBw != null) {
        return normBrzyckiBw;
    }
    const chargeUtile = shouldUseBrzyckiForRepsEquivalent(repsEquivalent)
        ? normalizedBrzycki
        : normalizedEpley;
    if (chargeUtile != null) {
        return roundKg(Number(chargeUtile) + weightedBw);
    }
    return normalizedOneRm ?? null;
}

/**
 * Valeur cible (reps/sec) depuis un 1RM — aligné forward/inverse sur MAX_BRZYCKI_TARGET_REPS.
 */
function computeRecommendedValueFromOneRmEstimate(
    oneRmKg,
    targetUnit,
    effectiveWeightLoadRaw,
    weightedBodyweightKg = 0,
    secondsToEquivalentRepsFn = null,
    repsEquivalentToSecondsFn = null,
) {
    const targetExternal = Number(effectiveWeightLoadRaw);
    if (!Number.isFinite(targetExternal)) {
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Charge cible invalide / Invalid target load.',
        };
    }

    const bodyweight = Number.isFinite(Number(weightedBodyweightKg)) ? Number(weightedBodyweightKg) : 0;
    const oneRmEffective = Number(oneRmKg);
    const targetEffectiveLoad = targetExternal + bodyweight;

    if (!Number.isFinite(oneRmEffective) || oneRmEffective <= 0
        || !Number.isFinite(targetEffectiveLoad) || targetEffectiveLoad <= 0) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Incalculable',
        };
    }

    const repsEquivalent = computeTargetRepsEquivalentFromOneRm(oneRmEffective, targetEffectiveLoad);
    if (!Number.isFinite(repsEquivalent) || repsEquivalent <= 0) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Incalculable',
        };
    }

    if (targetUnit === 'repetitions') {
        return { success: true, value: Math.round(repsEquivalent * 10) / 10 };
    }
    if (targetUnit === 'seconds') {
        if (typeof repsEquivalentToSecondsFn !== 'function') {
            return {
                success: false,
                reason: 'INVALID_INPUT',
                message: 'Unité cible invalide / Invalid target unit.',
            };
        }
        const seconds = repsEquivalentToSecondsFn(repsEquivalent);
        if (!Number.isFinite(seconds) || seconds <= 0) {
            return {
                success: false,
                reason: 'COMPUTATION_FAILED',
                message: 'Incalculable',
            };
        }
        return { success: true, value: Math.round(seconds) };
    }

    return {
        success: false,
        reason: 'INVALID_INPUT',
        message: 'Unité cible invalide / Invalid target unit.',
    };
}

/**
 * Premier set chronologique avec référence 1RM > 0, reps/sec > 0, et charge utile si applicable.
 */
function firstMeaningfulSetOneRmFromRange(sets) {
    if (!Array.isArray(sets) || sets.length === 0) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    const sorted = [...sets]
        .filter((e) => e?.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const set of sorted) {
        if (!hasPositiveTrainingVolume(set)) continue;
        const reference = resolvePeakOneRmReferenceKg(set);
        if (!Number.isFinite(reference) || reference <= 0) continue;
        return {
            brzycki: roundKg(resolveBrzyckiEstimateKg(set)),
            epley: roundKg(resolveEpleyEstimateKg(set)),
            reference: roundKg(reference),
            sourceSet: set,
        };
    }
    return { brzycki: null, epley: null, reference: null, sourceSet: null };
}

module.exports = {
    computeSetOneRepMaxEstimates,
    secondsToEquivalentReps,
    shouldUseBrzyckiForRepsEquivalent,
    isHighRepEquivalentSet,
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley,
    getExternalEffectiveLoadKg,
    getEffectiveLoadKg,
    getTrainingRepsEquivalent,
    resolveBrzyckiEstimateKg,
    resolveEpleyEstimateKg,
    resolvePeakOneRmReferenceKg,
    bestLastSetsOneRmFromSameSourceSet,
    bestLastSetsOneRmEstimates,
    mapSetWithPeakOneRmEstimates,
    mapSetForRecommendationPeak,
    resolveChargeUtileBrzyckiKg,
    resolveChargeUtileEpleyKg,
    firstSetOneRmFromRange,
    firstMeaningfulSetOneRmFromRange,
    computePercentageFromStart,
    roundKg,
    hasPositiveTrainingVolume,
    resolveAggregateNormalizedOneRm,
    resolveNormalizedOneRmForRecommendation,
    invertBrzyckiRepsFromOneRm,
    shouldIncludeBrzyckiInOneRmAggregate,
    computeTargetRepsEquivalentFromOneRm,
    computeRecommendedValueFromOneRmEstimate,
};
