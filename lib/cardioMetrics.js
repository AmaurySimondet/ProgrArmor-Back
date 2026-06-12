const {
    schema: { CARDIO_TYPE_ID, CARDIO_REP_EXCLUSION_VARIATION_IDS },
    set: { CARDIO_PR_METRICS },
} = require('../constants');

const CARDIO_REP_EXCLUSION_ID_SET = new Set(CARDIO_REP_EXCLUSION_VARIATION_IDS.map(String));

const round1 = (value) => Math.round(Number(value) * 10) / 10;
const round0 = (value) => Math.round(Number(value));

const computeDistanceKm = (speedKmh, durationSeconds) => {
    const speed = Number(speedKmh);
    const duration = Number(durationSeconds);
    if (!Number.isFinite(speed) || speed <= 0) return 0;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return round1(speed * (duration / 3600));
};

const computeElevationGainM = (distanceKm, inclinePercent) => {
    const distance = Number(distanceKm);
    const incline = Number(inclinePercent);
    if (!Number.isFinite(distance) || distance <= 0) return 0;
    if (!Number.isFinite(incline) || incline <= 0) return 0;
    return round0(distance * 1000 * (incline / 100));
};

const METRIC_KEYS = ['durationSeconds', 'distanceKm', 'speedKmh'];

function toPlainCardioPrSet(set) {
    if (!set) return null;
    if (typeof set.toObject === 'function') {
        return set.toObject({ virtuals: true, depopulate: true });
    }
    if (set._doc && typeof set._doc === 'object') {
        return {
            ...set._doc,
            cardio: set._doc.cardio ?? set.cardio ?? null,
        };
    }
    return set;
}

function getMetricTolerance(metric) {
    return CARDIO_PR_METRICS.tolerances[metric] ?? 0;
}

function isMetricValueValid(metric, value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return false;
    return true;
}

function extractCardioMetrics(set) {
    const durationSeconds = Math.max(0, Math.floor(Number(set?.value) || 0));
    const cardio = set?.cardio && typeof set.cardio === 'object' ? set.cardio : {};
    const inclinePercent = Number.isFinite(Number(cardio.inclinePercent)) ? Number(cardio.inclinePercent) : 0;
    let speedKmh = Number.isFinite(Number(cardio.speedKmh)) ? Number(cardio.speedKmh) : 0;
    let distanceKm = Number.isFinite(Number(cardio.distanceKm)) ? Number(cardio.distanceKm) : 0;

    if (distanceKm <= 0 && speedKmh > 0 && durationSeconds > 0) {
        distanceKm = computeDistanceKm(speedKmh, durationSeconds);
    }
    if (speedKmh <= 0 && distanceKm > 0 && durationSeconds > 0) {
        speedKmh = round1(distanceKm / (durationSeconds / 3600));
    }

    let elevationGainM = Number.isFinite(Number(cardio.elevationGainM)) ? Number(cardio.elevationGainM) : 0;
    if (elevationGainM <= 0 && distanceKm > 0 && inclinePercent > 0) {
        elevationGainM = computeElevationGainM(distanceKm, inclinePercent);
    }

    return {
        durationSeconds,
        distanceKm: distanceKm > 0 ? round1(distanceKm) : 0,
        speedKmh: speedKmh > 0 ? round1(speedKmh) : 0,
        elevationGainM: elevationGainM > 0 ? round0(elevationGainM) : 0,
        inclinePercent,
    };
}

function compareCardioMetric(currentValue, referenceValue, metric) {
    const tolerance = getMetricTolerance(metric);
    const current = Number(currentValue);
    const reference = Number(referenceValue);

    if (!Number.isFinite(current) || current <= 0) {
        return { beats: false, ties: false, worse: false, comparable: false };
    }
    if (!Number.isFinite(reference) || reference <= 0) {
        return { beats: true, ties: false, worse: false, comparable: true };
    }

    if (current > reference + tolerance) {
        return { beats: true, ties: false, worse: false, comparable: true };
    }
    if (Math.abs(current - reference) <= tolerance) {
        return { beats: false, ties: true, worse: false, comparable: true };
    }
    if (current < reference - tolerance) {
        return { beats: false, ties: false, worse: true, comparable: true };
    }
    return { beats: false, ties: false, worse: false, comparable: true };
}

function getMaxMetricAmongSets(sets, metric) {
    let maxValue = null;
    let bestSet = null;
    for (const set of sets || []) {
        const metrics = extractCardioMetrics(set);
        const value = metrics[metric];
        if (!isMetricValueValid(metric, value)) continue;
        if (maxValue == null || Number(value) > Number(maxValue)) {
            maxValue = Number(value);
            bestSet = set;
        }
    }
    return { maxValue, bestSet };
}

function compareCardioSetsByMetric(currentBest, candidate, metric) {
    if (!candidate) return currentBest;
    if (!currentBest) return candidate;

    const currentMetrics = extractCardioMetrics(currentBest);
    const candidateMetrics = extractCardioMetrics(candidate);
    const currentValue = currentMetrics[metric];
    const candidateValue = candidateMetrics[metric];

    if (!isMetricValueValid(metric, candidateValue)) return currentBest;
    if (!isMetricValueValid(metric, currentValue)) return candidate;
    if (Number(candidateValue) > Number(currentValue)) return candidate;
    if (Number(candidateValue) < Number(currentValue)) return currentBest;

    const currentDate = currentBest?.date ? new Date(currentBest.date).getTime() : 0;
    const candidateDate = candidate?.date ? new Date(candidate.date).getTime() : 0;
    return candidateDate >= currentDate ? candidate : currentBest;
}

function computeCardioPrsFromSets(sets = []) {
    const prs = {
        Last: { cardio: null },
        Temps: { cardio: null },
        Distance: { cardio: null },
        Vitesse: { cardio: null },
    };

    const cardioSets = (sets || [])
        .map((set) => toPlainCardioPrSet(set))
        .filter((set) => set?.unit === 'cardio');
    const sortedByDate = [...cardioSets].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const set of sortedByDate) {
        const metrics = extractCardioMetrics(set);
        if (metrics.durationSeconds > 0) {
            prs.Temps.cardio = compareCardioSetsByMetric(prs.Temps.cardio, set, 'durationSeconds');
        }
        if (metrics.distanceKm > 0) {
            prs.Distance.cardio = compareCardioSetsByMetric(prs.Distance.cardio, set, 'distanceKm');
        }
        if (metrics.speedKmh > 0) {
            prs.Vitesse.cardio = compareCardioSetsByMetric(prs.Vitesse.cardio, set, 'speedKmh');
        }
    }

    prs.Last.cardio = sortedByDate[sortedByDate.length - 1] || null;
    for (const key of Object.keys(prs)) {
        if (prs[key]?.cardio) {
            prs[key].cardio = toPlainCardioPrSet(prs[key].cardio);
        }
    }
    return prs;
}

function buildCardioPrDetail(currentMetrics, referenceMax, deltas = {}) {
    return {
        durationDelta: deltas.durationDelta ?? null,
        distanceDelta: deltas.distanceDelta ?? null,
        speedDelta: deltas.speedDelta ?? null,
        referenceBest: {
            durationSeconds: referenceMax.durationSeconds ?? null,
            distanceKm: referenceMax.distanceKm ?? null,
            speedKmh: referenceMax.speedKmh ?? null,
        },
        currentMetrics: {
            durationSeconds: currentMetrics.durationSeconds ?? null,
            distanceKm: currentMetrics.distanceKm ?? null,
            speedKmh: currentMetrics.speedKmh ?? null,
        },
    };
}

function evaluateCardioPersonalRecord(currentSet, historicalSets = [], sessionPeerSets = []) {
    const durationSeconds = Math.max(0, Math.floor(Number(currentSet?.value) || 0));
    if (durationSeconds <= 0) {
        return { isPersonalRecord: null, prDetail: null };
    }

    const currentMetrics = extractCardioMetrics({
        ...currentSet,
        value: durationSeconds,
        unit: 'cardio',
    });

    const referencePool = [...(historicalSets || []), ...(sessionPeerSets || [])]
        .filter((set) => set?.unit === 'cardio');

    if (referencePool.length === 0) {
        return {
            isPersonalRecord: 'NB',
            prDetail: buildCardioPrDetail(currentMetrics, {
                durationSeconds: null,
                distanceKm: null,
                speedKmh: null,
            }),
        };
    }

    const referenceMax = {
        durationSeconds: getMaxMetricAmongSets(referencePool, 'durationSeconds').maxValue,
        distanceKm: getMaxMetricAmongSets(referencePool, 'distanceKm').maxValue,
        speedKmh: getMaxMetricAmongSets(referencePool, 'speedKmh').maxValue,
    };

    let hasBeat = false;
    let hasTie = false;
    let comparableCount = 0;
    let worseCount = 0;

    for (const metric of METRIC_KEYS) {
        const comparison = compareCardioMetric(
            currentMetrics[metric],
            referenceMax[metric],
            metric,
        );
        if (!comparison.comparable) continue;
        comparableCount += 1;
        if (comparison.beats) hasBeat = true;
        if (comparison.ties) hasTie = true;
        if (comparison.worse) worseCount += 1;
    }

    const deltas = {
        durationDelta: referenceMax.durationSeconds != null && currentMetrics.durationSeconds > 0
            ? currentMetrics.durationSeconds - referenceMax.durationSeconds
            : null,
        distanceDelta: referenceMax.distanceKm != null && currentMetrics.distanceKm > 0
            ? round1(currentMetrics.distanceKm - referenceMax.distanceKm)
            : null,
        speedDelta: referenceMax.speedKmh != null && currentMetrics.speedKmh > 0
            ? round1(currentMetrics.speedKmh - referenceMax.speedKmh)
            : null,
    };

    const prDetail = buildCardioPrDetail(currentMetrics, referenceMax, deltas);

    if (hasBeat) {
        return { isPersonalRecord: 'PR', prDetail };
    }
    if (hasTie) {
        return { isPersonalRecord: 'SB', prDetail };
    }
    if (comparableCount > 0 && worseCount === comparableCount) {
        return { isPersonalRecord: null, prDetail };
    }
    return { isPersonalRecord: 'NB', prDetail };
}

function computeRelativePeakDistanceDiff(entryDistanceKm, peakDistanceKm) {
    const setValue = Number(entryDistanceKm);
    const peakValue = Number(peakDistanceKm);
    if (!Number.isFinite(setValue) || !Number.isFinite(peakValue) || peakValue <= 0) {
        return null;
    }
    return Math.abs(peakValue - setValue) / peakValue;
}

function enrichCardioPrSlotsWithPeakDiff(prs, peakReferenceDistanceKm) {
    if (!prs || typeof prs !== 'object') return prs;
    const enrichSlot = (slot) => {
        if (!slot || typeof slot !== 'object') return slot;
        const plain = toPlainCardioPrSet(slot);
        const metrics = extractCardioMetrics(plain);
        return {
            ...plain,
            peakForceDiff: computeRelativePeakDistanceDiff(metrics.distanceKm, peakReferenceDistanceKm),
            cardioDistanceKm: metrics.distanceKm > 0 ? metrics.distanceKm : null,
        };
    };
    const next = {};
    for (const [key, value] of Object.entries(prs)) {
        if (!value || typeof value !== 'object') {
            next[key] = value;
            continue;
        }
        next[key] = {
            cardio: enrichSlot(value.cardio),
        };
    }
    return next;
}

function buildChartHighlightFromCardioPoint(point) {
    if (!point) return null;
    if (point.setId) {
        return {
            setId: point.setId,
            seanceId: point.seanceId ?? null,
            date: point.date ?? null,
            matchStrategy: 'setId',
        };
    }
    if (point.seanceId) {
        return {
            setId: null,
            seanceId: point.seanceId,
            date: point.date ?? null,
            matchStrategy: 'seanceId',
        };
    }
    return null;
}

function computeCardioPeakFromPoints(points = [], { weightUnit = 'kg' } = {}) {
    const sorted = [...points]
        .filter((point) => Number(point?.distanceKm) > 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (sorted.length === 0) {
        return {
            mode: 'cardio',
            metric: 'distanceKm',
            referenceKm: null,
            referenceDistanceKm: null,
            percentageFromStart: null,
            source: null,
            firstSetPeak: null,
            chartHighlight: null,
            hasEstimate: false,
            weightUnit,
        };
    }

    let peakPoint = sorted[0];
    for (const point of sorted) {
        if (Number(point.distanceKm) > Number(peakPoint.distanceKm)) {
            peakPoint = point;
        }
    }

    const firstPoint = sorted[0];
    const firstDistance = Number(firstPoint.distanceKm);
    const peakDistance = Number(peakPoint.distanceKm);
    const percentageFromStart = Number.isFinite(firstDistance) && firstDistance > 0
        ? Math.round(((peakDistance - firstDistance) / firstDistance) * 1000) / 10
        : null;

    const source = {
        setId: peakPoint.setId != null ? String(peakPoint.setId) : null,
        seanceId: peakPoint.seanceId != null ? String(peakPoint.seanceId) : null,
        date: peakPoint.date ?? null,
        value: peakPoint.durationSeconds ?? null,
        distanceKm: peakDistance,
        speedKmh: peakPoint.speedKmh ?? null,
    };

    return {
        mode: 'cardio',
        metric: 'distanceKm',
        referenceKg: peakDistance,
        referenceDistanceKm: peakDistance,
        percentageFromStart,
        source,
        firstSetPeak: {
            referenceKg: firstDistance,
            referenceDistanceKm: firstDistance,
            source: {
                setId: firstPoint.setId != null ? String(firstPoint.setId) : null,
                seanceId: firstPoint.seanceId != null ? String(firstPoint.seanceId) : null,
                date: firstPoint.date ?? null,
                distanceKm: firstDistance,
            },
        },
        chartHighlight: buildChartHighlightFromCardioPoint(peakPoint),
        hasEstimate: false,
        weightUnit,
    };
}

function buildCardioPeaksBySignature(points = [], { weightUnit = 'kg' } = {}) {
    const bySignature = new Map();
    const counts = new Map();

    for (const point of points || []) {
        const signature = String(point?.sourceVariationSignature || '');
        if (!signature) continue;
        counts.set(signature, (counts.get(signature) || 0) + 1);
        if (!bySignature.has(signature)) bySignature.set(signature, []);
        bySignature.get(signature).push(point);
    }

    const peaksBySignature = {};
    for (const [signature, sigPoints] of bySignature.entries()) {
        peaksBySignature[signature] = computeCardioPeakFromPoints(sigPoints, { weightUnit });
    }

    const setCountsBySignature = {};
    for (const [signature, count] of counts.entries()) {
        setCountsBySignature[signature] = count;
    }

    return { peaksBySignature, setCountsBySignature };
}

function mapSetToCardioPoint(set, signature = null) {
    if (!set || set.unit !== 'cardio') return null;
    const metrics = extractCardioMetrics(set);
    if (metrics.durationSeconds <= 0) return null;

    return {
        setId: set._id != null ? String(set._id) : null,
        seanceId: set?.seance != null ? String(set.seance) : null,
        date: set.date,
        unit: 'cardio',
        durationSeconds: metrics.durationSeconds,
        distanceKm: metrics.distanceKm > 0 ? metrics.distanceKm : null,
        speedKmh: metrics.speedKmh > 0 ? metrics.speedKmh : null,
        elevationGainM: metrics.elevationGainM > 0 ? metrics.elevationGainM : null,
        sourceVariationSignature: signature,
        rawValue: metrics.durationSeconds,
    };
}

function isCardioScopeSets(sets = []) {
    if (!Array.isArray(sets) || sets.length === 0) return false;
    return sets.every((set) => set?.unit === 'cardio');
}

function isCardioVariationDoc(doc) {
    if (!doc) return false;
    if (doc.defaultMode === 'cardio') return true;
    const variationId = doc._id != null ? String(doc._id) : '';
    if (variationId && CARDIO_REP_EXCLUSION_ID_SET.has(variationId)) return false;
    return String(doc.type) === String(CARDIO_TYPE_ID);
}

function isCardioVariationSignature(signature, variationById) {
    const ids = String(signature || '').split('|').filter(Boolean);
    return ids.some((id) => isCardioVariationDoc(variationById?.get?.(String(id))));
}

function filterCardioSets(sets = []) {
    return (sets || []).filter((set) => set?.unit === 'cardio');
}

function shouldUseCardioPrPath(scopedSets, targetSignature, variationById) {
    if (isCardioScopeSets(scopedSets)) return true;
    if (isCardioVariationSignature(targetSignature, variationById)) return true;
    return filterCardioSets(scopedSets).length > 0;
}

module.exports = {
    extractCardioMetrics,
    compareCardioMetric,
    computeCardioPrsFromSets,
    evaluateCardioPersonalRecord,
    enrichCardioPrSlotsWithPeakDiff,
    computeCardioPeakFromPoints,
    buildCardioPeaksBySignature,
    mapSetToCardioPoint,
    isCardioScopeSets,
    isCardioVariationDoc,
    isCardioVariationSignature,
    filterCardioSets,
    shouldUseCardioPrPath,
    computeRelativePeakDistanceDiff,
};
