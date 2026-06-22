const { whichWeight: { MAX_SESSION_SETS } } = require('../constants');
const { getEffectiveLoadPreferringPersisted, resolvePrComparisonOneRmKg } = require('./set');

function normalizeCardioSessionSet(raw) {
    const value = Number(raw.value);
    if (!Number.isFinite(value) || value <= 0) return null;

    const normalized = {
        unit: 'cardio',
        value,
        weightLoad: raw.weightLoad != null ? Number(raw.weightLoad) : 0,
        isUnilateral: raw.isUnilateral === true,
        unilateralSide: raw.unilateralSide,
    };
    if (raw.cardio && typeof raw.cardio === 'object') {
        normalized.cardio = { ...raw.cardio };
    }
    if (raw.setOrder != null && Number.isFinite(Number(raw.setOrder))) {
        normalized.setOrder = Number(raw.setOrder);
    }
    return normalized;
}

/**
 * Séries « en cours » (client) utilisables pour comparer PR / ATH dans la même séance.
 * @param {unknown} sessionSets
 * @param {{ excludeSetId?: string|null, unit?: string|null, isUnilateral?: boolean, unilateralSide?: string|null }} filters
 * @returns {Array<Object>}
 */
function normalizeSessionSetsForPrEvaluation(sessionSets, filters = {}) {
    if (!Array.isArray(sessionSets) || sessionSets.length === 0) {
        return [];
    }

    const {
        excludeSetId = null,
        unit = null,
        isUnilateral = undefined,
        unilateralSide = undefined,
    } = filters;

    const excludeId = excludeSetId != null ? String(excludeSetId) : null;
    const out = [];

    for (const raw of sessionSets.slice(0, MAX_SESSION_SETS)) {
        if (!raw || typeof raw !== 'object') continue;

        const setId = raw._id != null ? String(raw._id) : null;
        if (excludeId && setId === excludeId) continue;

        const setUnit = raw.unit;
        if (unit && setUnit !== unit) continue;

        if (setUnit === 'cardio') {
            if (isUnilateral === true) {
                if (raw.isUnilateral !== true) continue;
                if (unilateralSide === 'left' || unilateralSide === 'right') {
                    if (raw.unilateralSide !== unilateralSide) continue;
                }
            }
            const normalizedCardio = normalizeCardioSessionSet(raw);
            if (normalizedCardio) out.push(normalizedCardio);
            continue;
        }

        if (setUnit !== 'repetitions' && setUnit !== 'seconds') continue;

        if (isUnilateral === true) {
            if (raw.isUnilateral !== true) continue;
            if (unilateralSide === 'left' || unilateralSide === 'right') {
                if (raw.unilateralSide !== unilateralSide) continue;
            }
        }

        const value = Number(raw.value);
        if (!Number.isFinite(value) || value < 0) continue;

        const weightLoad = raw.weightLoad != null ? Number(raw.weightLoad) : NaN;
        if (!Number.isFinite(weightLoad)) continue;

        let elastic = null;
        if (raw.elastic && typeof raw.elastic === 'object') {
            const tension = raw.elastic.tension;
            elastic = {
                type: raw.elastic.type,
                use: raw.elastic.use,
                tension: tension != null && tension !== '' ? Number(tension) : null,
            };
        }

        const effectiveWeightLoad = getEffectiveLoadPreferringPersisted({
            weightLoad,
            elastic,
            effectiveWeightLoad: raw.effectiveWeightLoad,
        });
        if (!Number.isFinite(effectiveWeightLoad)) continue;

        const normalized = {
            unit: setUnit,
            value,
            weightLoad,
            elastic,
            effectiveWeightLoad,
            isUnilateral: raw.isUnilateral === true,
            unilateralSide: raw.unilateralSide,
        };
        if (raw.setOrder != null && Number.isFinite(Number(raw.setOrder))) {
            normalized.setOrder = Number(raw.setOrder);
        }
        if (raw.effectiveWeightLoadLbs != null && Number.isFinite(Number(raw.effectiveWeightLoadLbs))) {
            normalized.effectiveWeightLoadLbs = Number(raw.effectiveWeightLoadLbs);
        }
        if (raw.weightLoadLbs != null && Number.isFinite(Number(raw.weightLoadLbs))) {
            normalized.weightLoadLbs = Number(raw.weightLoadLbs);
        }
        if (raw.brzycki != null && Number.isFinite(Number(raw.brzycki))) {
            normalized.brzycki = Number(raw.brzycki);
        }
        if (raw.epley != null && Number.isFinite(Number(raw.epley))) {
            normalized.epley = Number(raw.epley);
        }
        if (raw.normalizedOneRm != null && Number.isFinite(Number(raw.normalizedOneRm))) {
            normalized.normalizedOneRm = Number(raw.normalizedOneRm);
        }
        if (raw.repsEquivalent != null && Number.isFinite(Number(raw.repsEquivalent))) {
            normalized.repsEquivalent = Number(raw.repsEquivalent);
        }
        if (raw.oneRepMaxIncludesBodyweight === true) {
            normalized.oneRepMaxIncludesBodyweight = true;
        }
        if (raw.oneRepMaxUserWeightKg != null && Number.isFinite(Number(raw.oneRepMaxUserWeightKg))) {
            normalized.oneRepMaxUserWeightKg = Number(raw.oneRepMaxUserWeightKg);
        }
        if (raw.oneRepMaxExerciseBodyWeightRatio != null
            && Number.isFinite(Number(raw.oneRepMaxExerciseBodyWeightRatio))) {
            normalized.oneRepMaxExerciseBodyWeightRatio = Number(raw.oneRepMaxExerciseBodyWeightRatio);
        }
        if (raw.brzyckiWithBodyweight != null && Number.isFinite(Number(raw.brzyckiWithBodyweight))) {
            normalized.brzyckiWithBodyweight = Number(raw.brzyckiWithBodyweight);
        }
        if (raw.epleyWithBodyweight != null && Number.isFinite(Number(raw.epleyWithBodyweight))) {
            normalized.epleyWithBodyweight = Number(raw.epleyWithBodyweight);
        }
        out.push(normalized);
    }

    return out;
}

/**
 * Séries en cours strictement plus fortes (1RM) que la série évaluée — empêche un ATH
 * sur une série faible déjà dépassée dans la séance, sans pénaliser les copies identiques.
 */
function filterSessionPeersWithStrongerOneRm(sessionPeerSets, currentOneRmKg) {
    if (currentOneRmKg == null || !Number.isFinite(currentOneRmKg)) {
        return [];
    }
    return sessionPeerSets.filter((peer) => {
        const peerOneRm = resolvePrComparisonOneRmKg(peer);
        return peerOneRm != null && peerOneRm > currentOneRmKg;
    });
}

module.exports = {
    normalizeSessionSetsForPrEvaluation,
    filterSessionPeersWithStrongerOneRm,
};
