/**
 * Estimations 1RM Brzycki / Epley — même logique que l’app mobile (utils/oneRepMax.js).
 * @see https://en.wikipedia.org/wiki/One-repetition_maximum
 */

const toFiniteNumber = (value, fallback = 0) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/** @param {{ use?: string, tension?: number|null }} elastic */
const getSignedElasticTensionKg = (elastic) => {
    if (!elastic || elastic.tension === null || elastic.tension === undefined) return 0;
    const tension = toFiniteNumber(elastic.tension, 0);
    if (tension === 0) return 0;
    return elastic.use === "assistance" ? -tension : tension;
};

/** @param {{ weightLoad?: number|null, elastic?: object|null }} set */
const getExternalEffectiveLoadKg = (set) => {
    const w = toFiniteNumber(set?.weightLoad, 0);
    return w + getSignedElasticTensionKg(set?.elastic);
};

/**
 * @param {{ weightLoad?: number|null, elastic?: object|null }} set
 * @param {{ includeBodyweight?: boolean, userWeightKg?: number|null|undefined }} [options]
 */
const getEffectiveLoadKg = (set, options = {}) => {
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

/** @param {{ unit?: string, value?: number|null }} set */
const getTrainingRepsEquivalent = (set) => {
    const v = toFiniteNumber(set?.value, 0);
    if (set?.unit === "seconds") {
        return secondsToEquivalentReps(v);
    }
    return v;
};

const clampRepsForOneRmFormulas = (reps) => {
    const r = toFiniteNumber(reps, 0);
    if (r <= 0) return null;
    return Math.min(Math.max(r, 1), 36);
};

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

/**
 * @param {{ unit?: string, value?: number|null, weightLoad?: number|null, elastic?: object|null }} set
 * @returns {{ brzycki: number|null, epley: number|null }}
 */
function computeSetOneRepMaxEstimates(set) {
    const repsEq = getTrainingRepsEquivalent(set);
    const w = getEffectiveLoadKg(set);
    return {
        brzycki: roundKg(estimateOneRepMaxBrzycki(w, repsEq)),
        epley: roundKg(estimateOneRepMaxEpley(w, repsEq)),
    };
}

module.exports = {
    // Public helpers (used by backend + app)
    computeSetOneRepMaxEstimates,
    secondsToEquivalentReps,
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley,
    getExternalEffectiveLoadKg,
    getEffectiveLoadKg,
};

