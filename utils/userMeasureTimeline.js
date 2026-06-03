/**
 * Timeline UserMeasure : résolution du poids / fenêtres de validité / champs persistés bodyweight.
 */
const { computeSetOneRepMaxEstimates, getEffectiveLoadKg, getExternalEffectiveLoadKg } = require("./oneRepMax");
const { KG_TO_LB, round2 } = require("./seanceSetPersistedFields");

function sortMeasuresByDate(measures) {
    if (!Array.isArray(measures) || !measures.length) return [];
    return [...measures].sort(
        (a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime()
    );
}

function measureAtMs(measure) {
    const ms = new Date(measure?.measuredAt).getTime();
    return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Dernière mesure avec measuredAt <= date ; si aucune, première mesure (fait foi pour sets antérieurs).
 */
function resolveUserWeightKgForDate(userMeasures, date) {
    const sorted = sortMeasuresByDate(userMeasures);
    if (!sorted.length) return null;

    const target = date ? new Date(date) : new Date();
    const targetMs = Number.isFinite(target.getTime()) ? target.getTime() : Date.now();
    let latestBefore = null;

    for (const measure of sorted) {
        const atMs = measureAtMs(measure);
        if (!Number.isFinite(atMs)) continue;
        if (atMs <= targetMs) latestBefore = measure;
        else break;
    }

    const chosen = latestBefore ?? sorted[0];
    const kg = Number(chosen?.weight?.kg);
    return Number.isFinite(kg) && kg > 0 ? kg : null;
}

/**
 * Même règle que le poids : dernière mesure <= date, sinon première mesure.
 */
function resolveUserHeightMultiplierForDate(userMeasures, date) {
    const sorted = sortMeasuresByDate(userMeasures);
    if (!sorted.length) return 1;

    const target = date ? new Date(date) : new Date();
    const targetMs = Number.isFinite(target.getTime()) ? target.getTime() : Date.now();
    let latestBefore = null;

    for (const measure of sorted) {
        const atMs = measureAtMs(measure);
        if (!Number.isFinite(atMs)) continue;
        if (atMs <= targetMs) latestBefore = measure;
        else break;
    }

    const chosen = latestBefore ?? sorted[0];
    const m = Number(chosen?.heightMultiplier);
    return Number.isFinite(m) && m > 0 ? m : 1;
}

/**
 * Fenêtre [from, to) où cette mesure s'applique.
 * @param {Array} measures triées ou non
 * @param {number} measureIndex index dans le tableau trié
 */
function getMeasureValidityWindow(measures, measureIndex) {
    const sorted = sortMeasuresByDate(measures);
    const measure = sorted[measureIndex];
    if (!measure) return null;

    const next = sorted[measureIndex + 1];
    return {
        dateFrom: new Date(measure.measuredAt),
        dateTo: next ? new Date(next.measuredAt) : null,
    };
}

function findMeasureIndexByMeasuredAt(measures, measuredAt) {
    const sorted = sortMeasuresByDate(measures);
    const targetMs = new Date(measuredAt).getTime();
    if (!Number.isFinite(targetMs)) return -1;
    return sorted.findIndex((m) => measureAtMs(m) === targetMs);
}

function windowForMeasuredAt(measures, measuredAt) {
    const sorted = sortMeasuresByDate(measures);
    const idx = findMeasureIndexByMeasuredAt(sorted, measuredAt);
    if (idx < 0) return null;
    return getMeasureValidityWindow(sorted, idx);
}

/**
 * Fenêtre après suppression : [deletedMeasuredAt, première mesure restante après cette date).
 */
function windowAfterDeletedMeasure(measuresAfterDelete, deletedMeasuredAt) {
    const sorted = sortMeasuresByDate(measuresAfterDelete);
    const deletedMs = new Date(deletedMeasuredAt).getTime();
    if (!Number.isFinite(deletedMs)) return null;

    const next = sorted.find((m) => measureAtMs(m) > deletedMs);
    return {
        dateFrom: new Date(deletedMeasuredAt),
        dateTo: next ? new Date(next.measuredAt) : null,
    };
}

function mergeDateRanges(ranges) {
    const valid = (ranges || []).filter((r) => r && r.dateFrom);
    if (!valid.length) return [];
    const sorted = [...valid].sort((a, b) => a.dateFrom - b.dateFrom);
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i += 1) {
        const cur = sorted[i];
        const last = merged[merged.length - 1];
        const lastEnd = last.dateTo ? last.dateTo.getTime() : Infinity;
        const curStart = cur.dateFrom.getTime();

        if (curStart <= lastEnd) {
            if (!last.dateTo || (cur.dateTo && cur.dateTo > last.dateTo)) {
                last.dateTo = cur.dateTo;
            }
        } else {
            merged.push({ ...cur });
        }
    }
    return merged;
}

/**
 * Plages de dates de SeanceSet à recalculer après changement de mesure.
 * @param {{ measures: Array, newMeasuredAt?: Date|string, oldMeasuredAt?: Date|string }} params
 * measures = état actuel (après create/update ; après delete pour delete handler)
 */
function getAffectedDateRangesForMeasureChange({ measures, newMeasuredAt, oldMeasuredAt }) {
    const ranges = [];

    if (newMeasuredAt) {
        const w = windowForMeasuredAt(measures, newMeasuredAt);
        if (w) ranges.push(w);
    }

    if (oldMeasuredAt && newMeasuredAt) {
        const oldMs = new Date(oldMeasuredAt).getTime();
        const newMs = new Date(newMeasuredAt).getTime();
        if (Number.isFinite(oldMs) && Number.isFinite(newMs) && oldMs !== newMs) {
            const w = windowAfterDeletedMeasure(measures, oldMeasuredAt);
            if (w) ranges.push(w);
        }
    }

    return mergeDateRanges(ranges);
}

/**
 * @param {{ policy: { includeBodyweight: boolean, ratio: number }, userWeightKg: number|null }} params
 */
function computePersistedBodyweightFields(setDoc, { policy, userWeightKg }) {
    const externalLoad = getEffectiveLoadKg(setDoc, { includeBodyweight: false });
    const effectiveWeightLoad = round2(externalLoad);
    const effectiveWeightLoadLbs = effectiveWeightLoad != null ? round2(effectiveWeightLoad * KG_TO_LB) : null;
    const weightLoadLbs = Number.isFinite(Number(setDoc.weightLoad))
        ? round2(Number(setDoc.weightLoad) * KG_TO_LB)
        : null;

    let oneRepMaxIncludesBodyweight = false;
    let oneRepMaxUserWeightKg = null;
    let oneRepMaxExerciseBodyWeightRatio = null;
    let effectiveWeightLoadWithBodyweight = null;
    let effectiveWeightLoadWithBodyweightLbs = null;
    let brzyckiWithBodyweight = null;
    let epleyWithBodyweight = null;
    let brzycki = null;
    let epley = null;

    const externalForEstimate = getExternalEffectiveLoadKg(setDoc);
    const baseEstimates = computeSetOneRepMaxEstimates({
        ...setDoc,
        effectiveWeightLoad: externalForEstimate,
        elastic: setDoc.elastic ?? null,
    });
    brzycki = baseEstimates.brzycki;
    epley = baseEstimates.epley;

    if (policy?.includeBodyweight && Number.isFinite(Number(userWeightKg)) && userWeightKg > 0) {
        const ratio = Number.isFinite(Number(policy.ratio)) && policy.ratio > 0 ? Number(policy.ratio) : 1;
        const weighted = Number(userWeightKg) * ratio;
        const totalLoad = round2(externalLoad + weighted);

        oneRepMaxIncludesBodyweight = true;
        oneRepMaxUserWeightKg = round2(userWeightKg);
        oneRepMaxExerciseBodyWeightRatio = ratio;
        effectiveWeightLoadWithBodyweight = totalLoad;
        effectiveWeightLoadWithBodyweightLbs = totalLoad != null ? round2(totalLoad * KG_TO_LB) : null;

        const withBw = computeSetOneRepMaxEstimates({
            ...setDoc,
            effectiveWeightLoad: totalLoad,
            weightLoad: totalLoad,
            elastic: null,
        });
        brzyckiWithBodyweight = withBw.brzycki;
        epleyWithBodyweight = withBw.epley;
        brzycki = brzyckiWithBodyweight != null ? round2(brzyckiWithBodyweight - weighted) : null;
        epley = epleyWithBodyweight != null ? round2(epleyWithBodyweight - weighted) : null;
    }

    return {
        effectiveWeightLoad,
        effectiveWeightLoadWithBodyweight,
        weightLoadLbs,
        effectiveWeightLoadLbs,
        effectiveWeightLoadWithBodyweightLbs,
        brzycki,
        epley,
        oneRepMaxIncludesBodyweight,
        oneRepMaxUserWeightKg,
        oneRepMaxExerciseBodyWeightRatio,
        brzyckiWithBodyweight,
        epleyWithBodyweight,
    };
}

function buildSeanceSetDateQuery(ranges) {
    if (!ranges?.length) return {};
    if (ranges.length === 1) {
        const r = ranges[0];
        const date = {};
        if (r.dateFrom) date.$gte = r.dateFrom;
        if (r.dateTo) date.$lt = r.dateTo;
        return Object.keys(date).length ? { date } : {};
    }
    return {
        $or: ranges.map((r) => {
            const date = {};
            if (r.dateFrom) date.$gte = r.dateFrom;
            if (r.dateTo) date.$lt = r.dateTo;
            return { date };
        }),
    };
}

module.exports = {
    sortMeasuresByDate,
    resolveUserWeightKgForDate,
    resolveUserHeightMultiplierForDate,
    getMeasureValidityWindow,
    getAffectedDateRangesForMeasureChange,
    windowAfterDeletedMeasure,
    computePersistedBodyweightFields,
    buildSeanceSetDateQuery,
    mergeDateRanges,
};
