const {
    bestLastSetsOneRmFromSameSourceSet,
    firstMeaningfulSetOneRmFromRange,
    computePercentageFromStart,
    isHighRepEquivalentSet,
    getTrainingRepsEquivalent,
    getEffectiveLoadKg,
    roundKg,
    resolvePeakOneRmReferenceKg,
    resolveBrzyckiEstimateKg,
    resolveEpleyEstimateKg,
    hasPositiveTrainingVolume,
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley,
    shouldUseBrzyckiForRepsEquivalent,
    resolveAggregateNormalizedOneRm,
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
    progressionBasis = 'charge-utile',
}) {
    const pct = Number(percentageFromStart);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    const unit = normalizeWeightUnit(weightUnit);

    const firstSource = firstSetPeak?.source;
    const firstRef = Number(firstSetPeak?.referenceKg);
    const peakRef = Number(referenceKg);
    if (!firstSource?.date) return null;

    const [valueFr, valueEn] = formatValueLabel(firstSource.unit, firstSource.value);
    const firstLoadKg = Number.isFinite(Number(firstSource.weightLoad))
        ? Number(firstSource.weightLoad)
        : (Number.isFinite(Number(firstSource.rawWeightLoad)) ? Number(firstSource.rawWeightLoad) : null);
    const loadLabel = formatLoadLabelKg(firstLoadKg ?? 0, unit);
    const dateFr = formatDetailedDate(firstSource.date, 'fr');
    const dateEn = formatDetailedDate(firstSource.date, 'en');
    const variationFr = firstSource.variationLabel?.fr || 'cette variation';
    const variationEn = firstSource.variationLabel?.en || 'this variation';
    const formattedPct = `+${pct}%`;

    if (progressionBasis === 'bodyweight-effort') {
        return [
            `Progression affichée (${formattedPct}) : point de départ = première performance mesurable de la période (${variationFr}, ${valueFr} à ${loadLabel} le ${dateFr}), comparée au pic actuel. Charge utile nulle : estimation basée sur l'effort normalisé (répétitions / difficulté), pas sur un 1RM en charge ajoutée.`,
            `Displayed progression (${formattedPct}): start point = first measurable performance in the period (${variationEn}, ${valueEn} at ${loadLabel} on ${dateEn}), compared to the current peak. Zero useful load: estimate based on normalized effort (reps / difficulty), not on an added-load 1RM.`,
        ];
    }

    if (!Number.isFinite(firstRef) || firstRef <= 0 || !Number.isFinite(peakRef) || peakRef <= 0) {
        return null;
    }
    const firstRefLabel = formatLoadLabelKg(firstRef, unit);
    const peakRefLabel = formatLoadLabelKg(peakRef, unit);

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

function firstChronologicalFigurePointWithVolume(sortedPoints) {
    if (!Array.isArray(sortedPoints) || sortedPoints.length === 0) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    for (const point of sortedPoints) {
        if (!hasPositiveTrainingVolume(point)) continue;
        const reference = resolveFigurePointReferenceKg(point);
        return {
            brzycki: roundKg(resolveBrzyckiEstimateKg(point)),
            epley: roundKg(resolveEpleyEstimateKg(point)),
            reference: Number.isFinite(reference) && reference > 0 ? roundKg(reference) : null,
            sourceSet: point,
        };
    }
    return { brzycki: null, epley: null, reference: null, sourceSet: null };
}

function buildFirstSetPeakSummary(firstResult, mode) {
    if (!firstResult?.sourceSet) {
        return null;
    }
    const ref = Number(firstResult.reference);
    const source = buildSourceFromSet(firstResult.sourceSet, mode);
    return {
        referenceKg: Number.isFinite(ref) && ref > 0 ? firstResult.reference : null,
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
    progressionBasis = 'charge-utile',
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
            progressionBasis,
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

function summarizeFigurePointForDebug(point) {
    if (!point) return null;
    const repsEq = Number.isFinite(Number(point?.repsEquivalent))
        ? Number(point.repsEquivalent)
        : null;
    return {
        setId: point?.setId != null ? String(point.setId) : null,
        date: point?.date ?? null,
        rawValue: point?.rawValue ?? point?.value ?? null,
        unit: point?.unit ?? null,
        repsEquivalent: repsEq,
        rawWeightLoad: point?.rawWeightLoad ?? point?.weightLoad ?? null,
        brzycki: point?.brzycki ?? null,
        epley: point?.epley ?? null,
        normalizedOneRm: point?.normalizedOneRm ?? null,
        sourceVariationSignature: point?.sourceVariationSignature ?? null,
        sourceSetVariationIds: Array.isArray(point?.sourceSetVariationIds)
            ? point.sourceSetVariationIds.map((id) => String(id))
            : [],
    };
}

function resolveFigurePointExternalLoadKg(point) {
    const external = Number(point?.rawEffectiveWeightLoad);
    if (Number.isFinite(external)) return external;
    const raw = Number(point?.rawWeightLoad ?? point?.weightLoad);
    return Number.isFinite(raw) ? raw : 0;
}

function resolveFigurePointReferenceKg(point) {
    if (!point) return null;
    const normalized = Number(point?.normalizedOneRm);
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
    return resolvePeakOneRmReferenceKg(point);
}

function resolveFigureBodyweightEffortReferenceKg(point) {
    if (!point || point?.oneRepMaxIncludesBodyweight !== true) return null;
    const external = resolveFigurePointExternalLoadKg(point);
    if (!Number.isFinite(external) || external > 0) return null;

    const userWeightKg = Number(point?.oneRepMaxUserWeightKg);
    const bodyWeightRatio = Number(point?.oneRepMaxExerciseBodyWeightRatio);
    const difficultyFactor = Number(point?.difficultyFactor);
    const reps = getTrainingRepsEquivalent(point);
    if (!Number.isFinite(userWeightKg) || userWeightKg <= 0) return null;
    if (!Number.isFinite(difficultyFactor) || difficultyFactor <= 0) return null;
    if (!Number.isFinite(reps) || reps <= 0) return null;

    const ratio = Number.isFinite(bodyWeightRatio) && bodyWeightRatio > 0 ? bodyWeightRatio : 1;
    const fallbackLoad = (external + userWeightKg * ratio) * difficultyFactor;
    if (!Number.isFinite(fallbackLoad) || fallbackLoad <= 0) return null;

    const brzycki = shouldUseBrzyckiForRepsEquivalent(reps)
        ? estimateOneRepMaxBrzycki(fallbackLoad, reps)
        : null;
    const epley = estimateOneRepMaxEpley(fallbackLoad, reps);
    return resolveAggregateNormalizedOneRm(brzycki, epley, reps, fallbackLoad);
}

function resolveFigureProgressionReferenceKg(point, useBodyweightEffortProgression) {
    if (!point) return null;
    if (useBodyweightEffortProgression) {
        return resolveFigureBodyweightEffortReferenceKg(point);
    }
    return resolveFigurePointReferenceKg(point);
}

function shouldUseBodyweightEffortProgressionForScope(sortedPoints) {
    if (!Array.isArray(sortedPoints) || sortedPoints.length === 0) return false;
    const hasZeroExternalBodyweightFigure = sortedPoints.some((point) => (
        point?.oneRepMaxIncludesBodyweight === true
        && resolveFigurePointExternalLoadKg(point) <= 0
    ));
    if (!hasZeroExternalBodyweightFigure) return false;

    const peakChargeUtile = bestFigurePeakFromPoints(sortedPoints, undefined, resolveFigurePointReferenceKg);
    const firstChargeUtile = firstMeaningfulFigurePointFromRange(sortedPoints, resolveFigurePointReferenceKg);
    const chargeUtilePercentage = computePercentageFromStart(
        peakChargeUtile.reference,
        firstChargeUtile.reference,
    );
    return chargeUtilePercentage == null;
}

function bestFigurePeakFromPoints(sortedPoints, limit, resolveReferenceKg = resolveFigurePointReferenceKg) {
    if (!Array.isArray(sortedPoints) || sortedPoints.length === 0) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    const useRecentWindow = typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
    const slice = useRecentWindow
        ? sortedPoints.slice(-Math.min(limit, sortedPoints.length))
        : sortedPoints;
    const bestEntry = slice.reduce((acc, point) => {
        const candidate = resolveReferenceKg(point);
        if (!Number.isFinite(candidate) || candidate <= 0) return acc;
        if (!acc || candidate > acc.reference) {
            return { sourceSet: point, reference: candidate };
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

function firstMeaningfulFigurePointFromRange(sortedPoints, resolveReferenceKg = resolveFigurePointReferenceKg) {
    if (!Array.isArray(sortedPoints) || sortedPoints.length === 0) {
        return { brzycki: null, epley: null, reference: null, sourceSet: null };
    }
    for (const point of sortedPoints) {
        if (!hasPositiveTrainingVolume(point)) continue;
        const reference = resolveReferenceKg(point);
        if (!Number.isFinite(reference) || reference <= 0) continue;
        return {
            brzycki: roundKg(resolveBrzyckiEstimateKg(point)),
            epley: roundKg(resolveEpleyEstimateKg(point)),
            reference: roundKg(reference),
            sourceSet: point,
        };
    }
    return { brzycki: null, epley: null, reference: null, sourceSet: null };
}

function logStrengthPeakFigureDebug({
    sortedPoints,
    peakResult,
    firstResult,
    percentageFromStart,
    debugContext = null,
}) {
    if (process.env.STRENGTH_PEAK_DEBUG !== '1' && process.env.NODE_ENV === 'production') {
        return;
    }
    const legacyPeak = bestLastSetsOneRmFromSameSourceSet(sortedPoints);
    const legacyFirst = firstMeaningfulSetOneRmFromRange(sortedPoints);
    const nullReason = (() => {
        const peak = Number(peakResult?.reference);
        const first = Number(firstResult?.reference);
        if (!Number.isFinite(peak) || peak <= 0) return 'PEAK_REFERENCE_MISSING';
        if (!Number.isFinite(first) || first <= 0) return 'FIRST_REFERENCE_MISSING';
        if (peak <= first) return 'PEAK_LTE_FIRST';
        return null;
    })();
    console.debug('[Progression][StrengthPeak][Figure]', {
        ...(debugContext || {}),
        pointsInScope: sortedPoints.length,
        percentageFromStart,
        nullReason,
        peak: {
            referenceKg: peakResult?.reference ?? null,
            rawValue: peakResult?.sourceSet?.rawValue ?? null,
            setId: peakResult?.sourceSet?.setId ?? null,
            date: peakResult?.sourceSet?.date ?? null,
            brzycki: peakResult?.sourceSet?.brzycki ?? null,
            epley: peakResult?.sourceSet?.epley ?? null,
            normalizedOneRm: peakResult?.sourceSet?.normalizedOneRm ?? null,
        },
        first: {
            referenceKg: firstResult?.reference ?? null,
            rawValue: firstResult?.sourceSet?.rawValue ?? null,
            setId: firstResult?.sourceSet?.setId ?? null,
            date: firstResult?.sourceSet?.date ?? null,
            brzycki: firstResult?.sourceSet?.brzycki ?? null,
            epley: firstResult?.sourceSet?.epley ?? null,
            normalizedOneRm: firstResult?.sourceSet?.normalizedOneRm ?? null,
        },
        legacyBrzyckiOnly: {
            peakReferenceKg: legacyPeak?.reference ?? null,
            firstReferenceKg: legacyFirst?.reference ?? null,
            percentageFromStart: computePercentageFromStart(legacyPeak?.reference, legacyFirst?.reference),
        },
        chronologySample: sortedPoints.slice(0, 8).map(summarizeFigurePointForDebug),
    });
}

function computeStrengthPeakFromFigurePoints(points, options = {}) {
    const sortedPoints = Array.isArray(points)
        ? [...points].filter((p) => p?.date).sort((a, b) => new Date(a.date) - new Date(b.date))
        : [];

    const peakLimit = typeof options.maxSets === 'number' && Number.isFinite(options.maxSets) && options.maxSets > 0
        ? options.maxSets
        : undefined;
    const useBodyweightEffortProgression = shouldUseBodyweightEffortProgressionForScope(sortedPoints);
    const resolveProgressionReference = (point) => resolveFigureProgressionReferenceKg(
        point,
        useBodyweightEffortProgression,
    );

    const peakResult = bestFigurePeakFromPoints(sortedPoints, peakLimit, resolveFigurePointReferenceKg);
    const firstResult = firstMeaningfulFigurePointFromRange(sortedPoints, resolveFigurePointReferenceKg);
    const progressionPeakResult = bestFigurePeakFromPoints(sortedPoints, peakLimit, resolveProgressionReference);
    const progressionFirstResult = firstMeaningfulFigurePointFromRange(sortedPoints, resolveProgressionReference);
    const firstForDisplay = useBodyweightEffortProgression
        ? firstChronologicalFigurePointWithVolume(sortedPoints)
        : firstResult;
    const firstSetPeak = buildFirstSetPeakSummary(firstForDisplay, 'figure');
    const percentageFromStart = useBodyweightEffortProgression
        ? computePercentageFromStart(
            progressionPeakResult.reference,
            progressionFirstResult.reference,
        )
        : computePercentageFromStart(
            peakResult.reference,
            firstResult.reference,
        );
    const progressionBasis = useBodyweightEffortProgression ? 'bodyweight-effort' : 'charge-utile';

    logStrengthPeakFigureDebug({
        sortedPoints,
        peakResult,
        firstResult,
        percentageFromStart,
        debugContext: {
            ...(options.debugContext || {}),
            progressionBasis,
            progressionPeakReferenceKg: progressionPeakResult.reference ?? null,
            progressionFirstReferenceKg: progressionFirstResult.reference ?? null,
        },
    });

    return buildStrengthPeakPayload({
        mode: 'figure',
        brzyckiKg: peakResult.brzycki,
        epleyKg: peakResult.epley,
        referenceKg: peakResult.reference,
        sourceSet: normalizeFigureSourceSet(peakResult.sourceSet),
        firstSetPeak,
        percentageFromStart,
        weightUnit: normalizeWeightUnit(options.weightUnit),
        progressionBasis,
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

/**
 * Calcule un pic de force par signature de variation (sets/points déjà normalisés).
 * @param {Array<object>} points
 * @param {{ weightUnit?: string, debugContext?: object }} [options]
 * @returns {{ peaksBySignature: Record<string, object>, setCountsBySignature: Record<string, number> }}
 */
function buildStrengthPeaksBySignature(points, options = {}) {
    const peaksBySignature = {};
    const setCountsBySignature = {};
    if (!Array.isArray(points) || points.length === 0) {
        return { peaksBySignature, setCountsBySignature };
    }

    const groups = new Map();
    for (const point of points) {
        const signature = point?.sourceVariationSignature != null
            ? String(point.sourceVariationSignature)
            : '';
        if (!signature) continue;
        if (!groups.has(signature)) {
            groups.set(signature, []);
        }
        groups.get(signature).push(point);
        setCountsBySignature[signature] = (setCountsBySignature[signature] || 0) + 1;
    }

    for (const [signature, groupPoints] of groups.entries()) {
        const sorted = [...groupPoints].filter((p) => p?.date).sort((a, b) => new Date(a.date) - new Date(b.date));
        peaksBySignature[signature] = {
            ...computeStrengthPeakFromFigurePoints(sorted, options),
            sourceScope: 'signature',
            sourceVariationSignature: signature,
        };
    }

    return { peaksBySignature, setCountsBySignature };
}

module.exports = {
    computeStrengthPeakFromSets,
    computeStrengthPeakFromFigurePoints,
    buildStrengthPeaksBySignature,
    buildPeakSourceDescription,
    toRecommendationStrengthPeak,
    computePercentageFromStart,
    normalizeWeightUnit,
};
