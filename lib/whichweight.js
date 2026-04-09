const { getSets } = require('./set');
const Variation = require('../schema/variation');
const UserMeasure = require('../schema/userMeasure');
const {
    secondsToEquivalentReps,
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley,
    getEffectiveLoadKg,
} = require('../utils/oneRepMax');

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
    return UserMeasure.find({ userId }, { measuredAt: 1, 'weight.kg': 1 }).sort({ measuredAt: 1 }).lean();
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

/** Limite côté serveur pour éviter des payloads abusifs. */
const MAX_SESSION_SETS = 50;

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
            || eff <= 0
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

        if (!Number.isFinite(repsEq) || !Number.isFinite(effLoad) || effLoad <= 0) {
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
        const wEpley = ((oneRmKg + b) / denom) - b;
        if (Number.isFinite(wEpley) && wEpley > 0) {
            candidates.push(wEpley);
        }
    }

    if (r < 37) {
        const factor = (37 - r) / 36;
        const wBrzycki = ((oneRmKg + b) * factor) - b;
        if (Number.isFinite(wBrzycki) && wBrzycki > 0) {
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

    if (!Number.isFinite(loadKg) || loadKg <= 0) {
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
}) {
    if (!userId || !Array.isArray(variations) || !variations.length) {
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Paramètres invalides / Invalid parameters.'
        };
    }

    if (targetUnit !== 'repetitions' && targetUnit !== 'seconds') {
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
        variations
    );

    const requestPolicy = await getShouldIncludeBodyweightForRequestVariations(variations);
    const requestIncludesBodyweight = requestPolicy.includeBodyweight === true;
    const requestRatio = Number.isFinite(Number(requestPolicy.exerciseBodyWeightRatio))
        ? Number(requestPolicy.exerciseBodyWeightRatio)
        : 1;
    const userMeasures = requestIncludesBodyweight ? await getUserMeasuresByUser(userId) : [];
    const userWeightKg = resolveUserWeightKgForDate(userMeasures, new Date());
    const userWeightAvailable = Number.isFinite(Number(userWeightKg));

    const buildSetForEstimate = (set) => {
        const baseSet = set && typeof set.toObject === 'function' ? set.toObject() : set;
        const weightedBodyweightKg = requestIncludesBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * requestRatio
            : 0;
        return {
            ...baseSet,
            _weightedBodyweightKg: weightedBodyweightKg,
        };
    };

    const usableSets = sets
        .map(buildSetForEstimate)
        .filter((s) => {
            if (!s) return false;
            if (s.value == null || s.weightLoad == null || !s.date) return false;
            if (s.unit !== 'repetitions' && s.unit !== 'seconds') return false;
            const repsEq = getRepsEquivalentFromSet(s);
            const eff = toEffectiveLoadKg(s);
            return Number.isFinite(repsEq) && repsEq > 0 && Number.isFinite(eff) && eff > 0;
        });

    const sessionUsable = normalizeSessionSetsForEstimate(sessionSets).map(buildSetForEstimate);
    const combinedUsable = [...usableSets, ...sessionUsable];
    const usedSets = {
        fetchedHistoricalSets: Array.isArray(sets) ? sets.length : 0,
        usedHistoricalSets: usableSets.length,
        usedSessionSets: sessionUsable.length,
        usedTotalSets: combinedUsable.length,
        maxSetsRequested: Number(maxSets),
    };

    if (!combinedUsable.length) {
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
        return { ...set, brzycki, epley };
    });
    const { oneRmKg } = bestLastSetsOneRmEstimates(setsForOneRm, maxSets);

    if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) {
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
            usedSets,
        };
    }

    const weightedBodyweightKg = requestIncludesBodyweight && userWeightAvailable
        ? Number(userWeightKg) * requestRatio
        : 0;
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
        usedSets,
    };
    if (recommendation?.success && requestIncludesBodyweight && userWeightAvailable) {
        payload.loadKgWithBodyweight = Math.round((recommendation.loadKg + weightedBodyweightKg) * 2) / 2;
    }
    return payload;
}

module.exports = {
    bestLastSetsOneRmEstimates,
    computeTargetLoadFromOneRm,
    computeRecommendedLoad,
};

