/**
 * Converts elastic settings to a load delta.
 * resistance => +tension, assistance => -tension, otherwise 0.
 * @param {Object|null} elastic
 * @returns {number}
 */
function getElasticDelta(elastic) {
    if (!elastic || !elastic.use || elastic.tension == null) return 0;
    if (elastic.use === "resistance") return elastic.tension;
    if (elastic.use === "assistance") return -elastic.tension;
    return 0;
}

/**
 * Returns the effective load from a set-like object.
 * @param {Object|null} set
 * @returns {number}
 */
function getEffectiveLoad(set) {
    const weight = set?.weightLoad ?? 0;
    return weight + getElasticDelta(set?.elastic);
}

/**
 * Charge effective (kg) pour comparaison : utilise effectiveWeightLoad persisté si présent, sinon weightLoad + élastique.
 * @param {Object|null} set
 * @returns {number}
 */
function getEffectiveLoadPreferringPersisted(set) {
    const persisted = set?.effectiveWeightLoad;
    if (persisted != null && Number.isFinite(Number(persisted))) {
        return Number(persisted);
    }
    return getEffectiveLoad(set);
}

const {
    getTrainingRepsEquivalent,
    resolveBrzyckiEstimateKg,
    resolveEpleyEstimateKg,
    resolveAggregateNormalizedOneRm,
    resolveNormalizedOneRmForRecommendation,
} = require('./oneRepMax');

const LOAD_EPSILON = 0.001;

/**
 * 1RM comparatif pour tri PR / best set : normalizedOneRm si présent, sinon agrégat Brzycki+Epley (&lt;15 reps) ou Epley.
 * @param {Object|null} set
 * @returns {number|null}
 */
function resolvePrComparisonOneRmKg(set) {
    if (!set) return null;

    const normalized = Number(set.normalizedOneRm);
    if (Number.isFinite(normalized) && normalized > 0) {
        return normalized;
    }

    const repsEquivalent = Number.isFinite(Number(set.repsEquivalent))
        ? Number(set.repsEquivalent)
        : getTrainingRepsEquivalent(set);
    if (!Number.isFinite(repsEquivalent) || repsEquivalent <= 0) {
        return null;
    }

    const externalEffectiveLoad = getEffectiveLoadPreferringPersisted(set);
    const brzycki = set.normalizedBrzycki ?? resolveBrzyckiEstimateKg(set);
    const epley = set.normalizedEpley ?? resolveEpleyEstimateKg(set);

    if (set.oneRepMaxIncludesBodyweight === true) {
        const userWeightKg = Number(set.oneRepMaxUserWeightKg);
        const bodyWeightRatio = Number(set.oneRepMaxExerciseBodyWeightRatio);
        const ratio = Number.isFinite(bodyWeightRatio) && bodyWeightRatio > 0 ? bodyWeightRatio : 1;
        const weightedBodyweightKg = Number.isFinite(userWeightKg) && userWeightKg > 0
            ? userWeightKg * ratio
            : 0;
        const externalLoadKg = Number.isFinite(externalEffectiveLoad) ? externalEffectiveLoad : 0;
        const effectiveLoadKgForBrzyckiCheck = weightedBodyweightKg > 0
            ? externalLoadKg + weightedBodyweightKg
            : (externalLoadKg > 0 ? externalLoadKg : null);

        const withBodyweight = resolveNormalizedOneRmForRecommendation({
            normalizedBrzycki: brzycki,
            normalizedEpley: epley,
            brzyckiWithBodyweight: set.brzyckiWithBodyweight,
            epleyWithBodyweight: set.epleyWithBodyweight,
            weightedBodyweightKg,
            repsEquivalent,
            includeBodyweight: true,
            externalEffectiveLoadKg: externalLoadKg,
            effectiveLoadKgForBrzyckiCheck,
        });
        if (withBodyweight != null && Number.isFinite(withBodyweight) && withBodyweight > 0) {
            return withBodyweight;
        }
    }

    const aggregate = resolveAggregateNormalizedOneRm(
        brzycki,
        epley,
        repsEquivalent,
        externalEffectiveLoad > 0 ? externalEffectiveLoad : null,
    );

    return aggregate != null && Number.isFinite(aggregate) && aggregate > 0
        ? aggregate
        : null;
}

const toPlainObject = (value) => {
    if (!value) return value;
    if (typeof value.toObject === 'function') {
        return value.toObject();
    }
    return value;
};

const toPRPayload = (setLike) => ({
    ...toPlainObject(setLike),
    isUnilateral: setLike?.isUnilateral ?? false,
    unilateralSide: setLike?.unilateralSide,
    brzycki: setLike?.brzycki ?? null,
    rpe: setLike?.rpe ?? null,
});

/**
 * Compare deux sets via 1RM agrégé ; tie-break charge effective puis value.
 * @param {Object|null} currentPR
 * @param {Object} newSet
 * @returns {Object}
 */
function compareAndAssignPR(currentPR, newSet) {
    if (!currentPR) {
        return toPRPayload(newSet);
    }

    const currentOneRm = resolvePrComparisonOneRmKg(currentPR);
    const newOneRm = resolvePrComparisonOneRmKg(newSet);

    if (newOneRm == null) {
        return currentPR;
    }
    if (currentOneRm == null) {
        return toPRPayload(newSet);
    }

    let isBetter = false;

    if (newOneRm > currentOneRm) {
        isBetter = true;
    } else if (Math.abs(newOneRm - currentOneRm) <= LOAD_EPSILON) {
        const currentLoad = getEffectiveLoadPreferringPersisted(currentPR);
        const newLoad = getEffectiveLoadPreferringPersisted(newSet);
        if (newLoad > currentLoad + LOAD_EPSILON) {
            isBetter = true;
        } else if (Math.abs(newLoad - currentLoad) <= LOAD_EPSILON
            && (newSet.value ?? 0) > (currentPR.value ?? 0)) {
            isBetter = true;
        }
    }

    if (isBetter) {
        return toPRPayload(newSet);
    }

    return currentPR;
}

/**
 * Meilleure charge effective (kg) parmi des sets — gère les charges négatives (élastique d'assistance).
 * @param {Array<Object>} sets
 * @returns {number|null}
 */
function maxEffectiveLoadAmongSets(sets) {
    if (!Array.isArray(sets) || sets.length === 0) return null;
    let max = null;
    for (const set of sets) {
        const load = getEffectiveLoadPreferringPersisted(set);
        if (!Number.isFinite(load)) continue;
        if (max == null || load > max) max = load;
    }
    return max;
}

module.exports = {
    compareAndAssignPR,
    getElasticDelta,
    getEffectiveLoad,
    getEffectiveLoadPreferringPersisted,
    maxEffectiveLoadAmongSets,
    resolvePrComparisonOneRmKg,
    LOAD_EPSILON,
};
