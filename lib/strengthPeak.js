const {
    bestLastSetsOneRmFromSameSourceSet,
    firstMeaningfulSetOneRmFromRange,
    computePercentageFromStart,
    isHighRepEquivalentSet,
    getTrainingRepsEquivalent,
    getEffectiveLoadKg,
    roundKg,
} = require('../utils/oneRepMax');

function toIsoDateString(date) {
    if (!date) return null;
    const d = new Date(date);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
}

function formatDetailedDate(date, language = 'fr') {
    const d = new Date(date);
    if (!Number.isFinite(d.getTime())) return '-';
    return d.toLocaleDateString(language === 'en' ? 'en-US' : 'fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

function normalizeWeightUnit(weightUnit) {
    const unit = String(weightUnit || 'kg').toLowerCase();
    return unit === 'lb' || unit === 'lbs' ? 'lb' : 'kg';
}

function resolveSeanceIdFromEntity(entity) {
    if (!entity) return null;
    if (entity.seanceId != null) return String(entity.seanceId);
    if (entity.seance != null) return String(entity.seance);
    return null;
}

function buildChartHighlightFromSource(source) {
    if (!source) return null;
    if (source.setId) {
        return {
            setId: source.setId,
            seanceId: source.seanceId ?? null,
            date: source.date ?? null,
            matchStrategy: 'setId',
        };
    }
    if (source.seanceId) {
        return {
            setId: null,
            seanceId: source.seanceId,
            date: source.date ?? null,
            matchStrategy: 'seanceId',
        };
    }
    return null;
}

function formatLoadLabelKg(kg, weightUnit = 'kg') {
    const n = Number(kg);
    if (!Number.isFinite(n)) return '-';
    const unit = normalizeWeightUnit(weightUnit);
    if (unit === 'lb') {
        const lbs = Math.round(n * 2.2046226218 * 10) / 10;
        return `${lbs} lbs`;
    }
    return `${Math.round(n * 10) / 10} kg`;
}

function formatValueLabel(unit, value) {
    if (value == null || value === '') return ['-', '-'];
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return ['-', '-'];
    if (unit === 'seconds') {
        return [`${numericValue} sec`, `${numericValue} sec`];
    }
    return [`${numericValue} rep`, `${numericValue} reps`];
}

function resolveVariationLabel(entity, language, fallback) {
    const merged = entity?.mergedVariationsNames;
    if (merged && typeof merged === 'object') {
        const mergedLabel = merged[language] || merged.fr || merged.en;
        if (typeof mergedLabel === 'string' && mergedLabel.trim()) return mergedLabel.trim();
    }
    const displayName = entity?.variationDisplayName;
    if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();
    const directLocalized = entity?.name?.[language];
    if (typeof directLocalized === 'string' && directLocalized.trim()) return directLocalized.trim();
    const variationNames = (entity?.variations || [])
        .map((variation) => variation?.name?.[language] || variation?.name?.fr || variation?.name?.en)
        .filter((name) => typeof name === 'string' && name.trim())
        .map((name) => name.trim());
    if (variationNames.length > 0) return variationNames.join(', ');
    return fallback;
}

function buildSourceFromSet(set, mode = 'normal') {
    if (!set) return null;
    const entity = mode === 'figure' ? (normalizeFigureSourceSet(set) ?? set) : set;
    const setId = entity._id != null ? String(entity._id) : (entity.setId != null ? String(entity.setId) : null);
    const seanceId = resolveSeanceIdFromEntity(entity);
    const dateIso = toIsoDateString(entity.date);
    const displayValue = Number.isFinite(Number(entity.rawValue))
        ? Number(entity.rawValue)
        : (Number.isFinite(Number(entity.value)) ? Number(entity.value) : null);
    const displayWeightLoad = Number.isFinite(Number(entity.rawWeightLoad))
        ? Number(entity.rawWeightLoad)
        : (Number.isFinite(Number(entity.weightLoad)) ? Number(entity.weightLoad) : null);
    const repsEq = Number.isFinite(Number(entity.repsEquivalent))
        ? Number(entity.repsEquivalent)
        : getTrainingRepsEquivalent({
            ...entity,
            value: displayValue,
            unit: entity.unit || 'repetitions',
        });
    const variationLabel = {
        fr: resolveVariationLabel(entity, 'fr', 'cette variation'),
        en: resolveVariationLabel(entity, 'en', 'this variation'),
    };
    const mergedVariationsNames = entity?.mergedVariationsNames && typeof entity.mergedVariationsNames === 'object'
        ? {
            fr: entity.mergedVariationsNames.fr || null,
            en: entity.mergedVariationsNames.en || null,
        }
        : null;

    const source = {
        setId,
        seanceId,
        date: dateIso,
        unit: entity.unit || 'repetitions',
        value: displayValue,
        weightLoad: displayWeightLoad,
        rawValue: displayValue,
        rawWeightLoad: displayWeightLoad,
        effectiveWeightLoadKg: Number.isFinite(Number(entity.rawEffectiveWeightLoad))
            ? roundKg(Number(entity.rawEffectiveWeightLoad))
            : roundKg(getEffectiveLoadKg(entity)),
        repsEquivalent: Number.isFinite(repsEq) ? repsEq : null,
        variationLabel,
        mergedVariationsNames,
    };

    if (mode === 'figure') {
        source.sourceVariationId = entity.sourceVariationId != null ? String(entity.sourceVariationId) : null;
        source.targetVariationId = entity.targetVariationId != null ? String(entity.targetVariationId) : null;
        source.difficultyRatioUsed = Number.isFinite(Number(entity.difficultyRatioUsed))
            ? Number(entity.difficultyRatioUsed)
            : null;
        source.difficultyFactor = Number.isFinite(Number(entity.difficultyFactor))
            ? Number(entity.difficultyFactor)
            : null;
        source.normalizedEffectiveWeightLoad = Number.isFinite(Number(entity.normalizedEffectiveWeightLoad))
            ? Number(entity.normalizedEffectiveWeightLoad)
            : null;
        source.pathNames = Array.isArray(entity.pathNames) ? entity.pathNames : null;
        source.extrapolated = entity.extrapolated === true;
    }

    return source;
}

function buildPeakSourceDescription(source, mode, weightUnit = 'kg') {
    if (!source?.setId && !source?.seanceId && !source?.date) return null;
    const unit = normalizeWeightUnit(weightUnit);
    const [valueFr, valueEn] = formatValueLabel(source.unit, source.value);
    const loadKg = Number.isFinite(Number(source.weightLoad))
        ? Number(source.weightLoad)
        : (Number.isFinite(Number(source.rawWeightLoad)) ? Number(source.rawWeightLoad) : 0);
    const loadLabel = formatLoadLabelKg(loadKg, unit);
    const dateFr = formatDetailedDate(source.date, 'fr');
    const dateEn = formatDetailedDate(source.date, 'en');
    const variationFr = source.variationLabel?.fr || 'cette variation';
    const variationEn = source.variationLabel?.en || 'this variation';

    if (mode === 'figure') {
        const ratio = Number.isFinite(Number(source.difficultyRatioUsed))
            ? Number(source.difficultyRatioUsed).toFixed(3)
            : '?';
        return [
            `Pic normalisé : ta performance ${variationFr} ${valueFr} à ${loadLabel} le ${dateFr} est comparée aux autres figures via un ratio de difficulté ×${ratio} (référence commune, morphologie incluse).`,
            `Normalized peak: your ${variationEn} performance ${valueEn} at ${loadLabel} on ${dateEn} is compared across figures using difficulty ratio ×${ratio} (common reference, bodyweight included).`,
        ];
    }

    return [
        `Ce pic vient de ta performance ${variationFr} ${valueFr} à ${loadLabel} le ${dateFr}.`,
        `This peak comes from your ${variationEn} performance: ${valueEn} at ${loadLabel} on ${dateEn}.`,
    ];
}

/**
 * Paragraphe optionnel : d’où vient le % de progression (première perf mesurable de la période).
 */
function buildProgressionFromStartDescription({
    percentageFromStart,
    firstSetPeak,
    referenceKg,
    mode,
    weightUnit = 'kg',
}) {
    const pct = Number(percentageFromStart);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    const unit = normalizeWeightUnit(weightUnit);

    const firstSource = firstSetPeak?.source;
    const firstRef = Number(firstSetPeak?.referenceKg);
    const peakRef = Number(referenceKg);
    if (!firstSource?.date || !Number.isFinite(firstRef) || firstRef <= 0 || !Number.isFinite(peakRef) || peakRef <= 0) {
        return null;
    }

    const [valueFr, valueEn] = formatValueLabel(firstSource.unit, firstSource.value);
    const firstLoadKg = Number.isFinite(Number(firstSource.weightLoad))
        ? Number(firstSource.weightLoad)
        : (Number.isFinite(Number(firstSource.rawWeightLoad)) ? Number(firstSource.rawWeightLoad) : null);
    const loadLabel = formatLoadLabelKg(firstLoadKg ?? 0, unit);
    const dateFr = formatDetailedDate(firstSource.date, 'fr');
    const dateEn = formatDetailedDate(firstSource.date, 'en');
    const variationFr = firstSource.variationLabel?.fr || 'cette variation';
    const variationEn = firstSource.variationLabel?.en || 'this variation';
    const firstRefLabel = formatLoadLabelKg(firstRef, unit);
    const peakRefLabel = formatLoadLabelKg(peakRef, unit);
    const formattedPct = `+${pct}%`;

    if (mode === 'figure') {
        return [
            `Progression affichée (${formattedPct}) : point de départ = première performance mesurable de la période (${variationFr}, ${valueFr} à ${loadLabel} le ${dateFr}, 1RM normalisé ~${firstRefLabel}), comparée au pic actuel (~${peakRefLabel}).`,
            `Displayed progression (${formattedPct}): start point = first measurable performance in the period (${variationEn}, ${valueEn} at ${loadLabel} on ${dateEn}, normalized 1RM ~${firstRefLabel}), compared to the current peak (~${peakRefLabel}).`,
        ];
    }

    return [
        `Progression affichée (${formattedPct}) : point de départ = ${variationFr}, ${valueFr} à ${loadLabel} le ${dateFr} (1RM estimé ~${firstRefLabel}), comparée au pic actuel (~${peakRefLabel}).`,
        `Displayed progression (${formattedPct}): start point = ${variationEn}, ${valueEn} at ${loadLabel} on ${dateEn} (estimated 1RM ~${firstRefLabel}), compared to the current peak (~${peakRefLabel}).`,
    ];
}

function normalizeFigureSourceSet(point) {
    if (!point) return null;
    return {
        ...point,
        setId: point.setId,
        value: point.rawValue ?? point.value,
        weightLoad: point.rawWeightLoad ?? point.weightLoad,
        unit: point.unit ?? 'repetitions',
        difficultyRatioUsed: point.difficultyRatioUsed,
        difficultyFactor: point.difficultyFactor,
        normalizedEffectiveWeightLoad: point.normalizedEffectiveWeightLoad,
        pathNames: point.pathNames,
    };
}

function buildFirstSetPeakSummary(firstResult, mode) {
    if (!firstResult?.sourceSet) {
        return null;
    }
    const ref = Number(firstResult.reference);
    if (!Number.isFinite(ref) || ref <= 0) {
        return null;
    }
    const source = buildSourceFromSet(firstResult.sourceSet, mode);
    return {
        referenceKg: firstResult.reference,
        brzyckiKg: firstResult.brzycki,
        epleyKg: firstResult.epley,
        source,
        chartHighlight: buildChartHighlightFromSource(source),
    };
}

function buildStrengthPeakPayload({
    mode,
    brzyckiKg,
    epleyKg,
    referenceKg,
    sourceSet,
    firstSetPeak,
    percentageFromStart,
    weightUnit = 'kg',
}) {
    const unit = normalizeWeightUnit(weightUnit);
    const hasEstimate = Number.isFinite(referenceKg) && referenceKg > 0;
    const source = hasEstimate ? buildSourceFromSet(sourceSet, mode) : null;
    const showBrzyckiIncalculable = mode === 'normal'
        && hasEstimate
        && sourceSet
        && isHighRepEquivalentSet(sourceSet);

    const chartHighlight = buildChartHighlightFromSource(source);

    return {
        mode,
        brzyckiKg: brzyckiKg ?? null,
        epleyKg: epleyKg ?? null,
        referenceKg: referenceKg ?? null,
        hasEstimate,
        showBrzyckiIncalculable,
        oneRepMaxIncludesBodyweight: sourceSet?.oneRepMaxIncludesBodyweight === true,
        oneRepMaxUserWeightKg: Number.isFinite(Number(sourceSet?.oneRepMaxUserWeightKg))
            ? Number(sourceSet.oneRepMaxUserWeightKg)
            : null,
        oneRepMaxExerciseBodyWeightRatio: Number.isFinite(Number(sourceSet?.oneRepMaxExerciseBodyWeightRatio))
            ? Number(sourceSet.oneRepMaxExerciseBodyWeightRatio)
            : null,
        source,
        chartHighlight,
        firstSetPeak: firstSetPeak ?? null,
        percentageFromStart: percentageFromStart ?? null,
        peakSourceDescription: hasEstimate ? buildPeakSourceDescription(source, mode, unit) : null,
        progressionFromStartDescription: buildProgressionFromStartDescription({
            percentageFromStart,
            firstSetPeak,
            referenceKg,
            mode,
            weightUnit: unit,
        }),
    };
}

function computeStrengthPeakFromSets(sets, options = {}) {
    const sortedSets = Array.isArray(sets)
        ? [...sets].filter((s) => s?.date).sort((a, b) => new Date(a.date) - new Date(b.date))
        : [];

    const peakLimit = typeof options.maxSets === 'number' && Number.isFinite(options.maxSets) && options.maxSets > 0
        ? options.maxSets
        : undefined;
    const peakResult = bestLastSetsOneRmFromSameSourceSet(sortedSets, peakLimit);
    const firstResult = firstMeaningfulSetOneRmFromRange(sortedSets);
    const firstSetPeak = buildFirstSetPeakSummary(firstResult, 'normal');
    const percentageFromStart = computePercentageFromStart(
        peakResult.reference,
        firstResult.reference,
    );

    return buildStrengthPeakPayload({
        mode: 'normal',
        brzyckiKg: peakResult.brzycki,
        epleyKg: peakResult.epley,
        referenceKg: peakResult.reference,
        sourceSet: peakResult.sourceSet,
        firstSetPeak,
        percentageFromStart,
        weightUnit: normalizeWeightUnit(options.weightUnit),
    });
}

function computeStrengthPeakFromFigurePoints(points, options = {}) {
    const sortedPoints = Array.isArray(points)
        ? [...points].filter((p) => p?.date).sort((a, b) => new Date(a.date) - new Date(b.date))
        : [];

    const peakLimit = typeof options.maxSets === 'number' && Number.isFinite(options.maxSets) && options.maxSets > 0
        ? options.maxSets
        : undefined;
    const peakResult = bestLastSetsOneRmFromSameSourceSet(sortedPoints, peakLimit);
    const firstResult = firstMeaningfulSetOneRmFromRange(sortedPoints);
    const firstSetPeak = buildFirstSetPeakSummary(firstResult, 'figure');
    const percentageFromStart = computePercentageFromStart(
        peakResult.reference,
        firstResult.reference,
    );

    return buildStrengthPeakPayload({
        mode: 'figure',
        brzyckiKg: peakResult.brzycki,
        epleyKg: peakResult.epley,
        referenceKg: peakResult.reference,
        sourceSet: normalizeFigureSourceSet(peakResult.sourceSet),
        firstSetPeak,
        percentageFromStart,
        weightUnit: normalizeWeightUnit(options.weightUnit),
    });
}

/** Mappe vers le format strengthPeak legacy des endpoints whichweight/whichvalue */
function toRecommendationStrengthPeak(strengthPeak, weightedBodyweightKg = 0) {
    const referenceKg = strengthPeak?.referenceKg;
    const brzyckiKg = strengthPeak?.brzyckiKg;
    const epleyKg = strengthPeak?.epleyKg;
    const kgToLbs = (kg) => {
        const n = Number(kg);
        if (!Number.isFinite(n)) return null;
        return Math.round(n * 2.2046226218 * 100) / 100;
    };
    const peakEffectiveWeightLoadKg = Number.isFinite(referenceKg)
        ? roundKg(Number(referenceKg) - Number(weightedBodyweightKg || 0))
        : null;

    return {
        oneRmKg: referenceKg ?? null,
        oneRmLbs: kgToLbs(referenceKg),
        peakEffectiveWeightLoadKg,
        peakEffectiveWeightLoadLbs: kgToLbs(peakEffectiveWeightLoadKg),
        maxBrzycki: brzyckiKg ?? null,
        maxBrzyckiLbs: kgToLbs(brzyckiKg),
        maxEpley: epleyKg ?? null,
        maxEpleyLbs: kgToLbs(epleyKg),
    };
}

module.exports = {
    computeStrengthPeakFromSets,
    computeStrengthPeakFromFigurePoints,
    buildPeakSourceDescription,
    toRecommendationStrengthPeak,
    computePercentageFromStart,
    normalizeWeightUnit,
};
