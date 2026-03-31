const { getSets } = require('./set');
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
    const load = getEffectiveLoadKg(set);
    return Number.isFinite(load) ? load : null;
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

function computeTargetLoadFromOneRm(oneRmKg, targetUnit, targetValueRaw) {
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

    const denom = 1 + r / 30;
    if (denom > 0) {
        const wEpley = oneRmKg / denom;
        if (Number.isFinite(wEpley) && wEpley > 0) {
            candidates.push(wEpley);
        }
    }

    if (r < 37) {
        const factor = (37 - r) / 36;
        const wBrzycki = oneRmKg * factor;
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

async function computeRecommendedLoad({ userId, variations, targetUnit, targetValue, maxSets = 10 }) {
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

    const usableSets = sets.filter(s => {
        if (!s) return false;
        if (s.value == null || s.weightLoad == null || !s.date) return false;
        if (s.unit !== 'repetitions' && s.unit !== 'seconds') return false;
        const repsEq = getRepsEquivalentFromSet(s);
        const eff = toEffectiveLoadKg(s);
        return Number.isFinite(repsEq) && repsEq > 0 && Number.isFinite(eff) && eff > 0;
    });

    if (!usableSets.length) {
        return {
            success: false,
            reason: 'NO_DATA',
            message: 'Aucune série trouvée pour cet exercice, impossible de calculer une charge. / No sets found for this exercise, unable to compute a load.'
        };
    }

    const { oneRmKg } = bestLastSetsOneRmEstimates(usableSets, maxSets);

    if (!Number.isFinite(oneRmKg) || oneRmKg <= 0) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une charge fiable avec les données actuelles.'
        };
    }

    return computeTargetLoadFromOneRm(oneRmKg, targetUnit, targetValue);
}

module.exports = {
    bestLastSetsOneRmEstimates,
    computeTargetLoadFromOneRm,
    computeRecommendedLoad,
};

