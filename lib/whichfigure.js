const mongoose = require('mongoose');
const setLib = require('./set');
const Variation = require('../schema/variation');
const VariationProgressionEdge = require('../schema/variationProgressionEdge');
const UserMeasure = require('../schema/userMeasure');
const { whichWeight: { MAX_BRZYCKI_TARGET_REPS } } = require('../constants');
const {
    secondsToEquivalentReps,
    resolveNormalizedOneRmForRecommendation,
    estimateOneRepMaxBrzycki,
    estimateOneRepMaxEpley,
    shouldUseBrzyckiForRepsEquivalent,
    shouldIncludeBrzyckiInOneRmAggregate,
    invertBrzyckiRepsFromOneRm,
    computeRecommendedValueFromOneRmEstimate,
} = require('../utils/oneRepMax');
const { getDifficultyRatio, buildAdjacencyList } = require('./variationDifficultyGraph');
const { resolveMainExerciseIdForProgression, normalizeLateralMode } = require('./progressionResolution');
const { estimateOneRmPeakFromSessionSets } = require('./whichweight');
const { resolveUserWeightKgForDate } = require('../utils/userMeasureTimeline');

function toNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toRounded(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = 10 ** decimals;
    return Math.round((n + Number.EPSILON) * factor) / factor;
}

function isValidObjectIdString(value) {
    const id = String(value || '');
    return Boolean(id) && mongoose.Types.ObjectId.isValid(id);
}

function parseProgressionSignatureToObjectIds(signature) {
    const raw = String(signature || '');
    if (!raw) return [];
    if (!raw.includes('|')) {
        return isValidObjectIdString(raw) ? [raw] : [];
    }
    return raw.split('|').map((part) => String(part).trim()).filter(isValidObjectIdString);
}

function resolveFigureEntryTargetKey(entry) {
    if (!entry) return '';
    return String(entry.variationSignature || entry.variationId || '');
}

function summarizeFigureEntryForDebug(entry) {
    const key = resolveFigureEntryTargetKey(entry);
    const name = entry?.name?.fr || entry?.name?.en || entry?.name || null;
    const sets = getUsedHistoricalSetsFromDetailedPrs(entry?.prs);
    return { key, name, sets, isDirect: entry?.isDirect === true };
}

function summarizeEntryPrsPeakForDebug(entry) {
    const peak = collectBestPeakFromDetailedPrs(entry?.prs);
    return {
        ...summarizeFigureEntryForDebug(entry),
        peakOneRm: peak?.normalizedOneRm ?? null,
        peakSetId: peak?.setId ?? null,
        peakSourceVariationId: peak?.sourceVariationId ?? null,
        peakWeightLoad: peak?.weightLoad ?? null,
        peakValue: peak?.value ?? null,
    };
}

function logFigureRecommendationsDedupeDiff(kind, before = [], after = []) {
    const afterKeys = new Set(after.map((entry) => String(
        entry?.variationSignature || entry?.variationId || entry?.name?.fr || entry?.name?.en || '',
    )));
    const dropped = before.filter((entry) => {
        const key = String(entry?.variationSignature || entry?.variationId || '');
        const nameKey = normalizeFigureName(entry?.name?.fr || entry?.name?.en || '');
        return !after.some((kept) => {
            const keptKey = String(kept?.variationSignature || kept?.variationId || '');
            const keptName = normalizeFigureName(kept?.name?.fr || kept?.name?.en || '');
            return (key && keptKey === key) || (nameKey && keptName === nameKey);
        });
    }).map((entry) => ({
        key: entry?.variationSignature || entry?.variationId || null,
        name: entry?.name?.fr || entry?.name?.en || null,
        historicalSets: entry?.usedSets?.usedHistoricalSets ?? null,
        recommendedValue: entry?.recommendedValue ?? entry?.recommendedLoadKg ?? null,
        peakOneRm: entry?.strengthPeak?.normalizedOneRm ?? null,
        isDirect: entry?.isDirect === true,
    }));
    logFigureEntryPipelineStage(`${kind}:recommendations-dedupe`, {
        beforeCount: before.length,
        afterCount: after.length,
        dropped,
        afterSummaries: after.map((entry) => ({
            key: entry?.variationSignature || entry?.variationId || null,
            name: entry?.name?.fr || entry?.name?.en || null,
            historicalSets: entry?.usedSets?.usedHistoricalSets ?? null,
            recommendedValue: entry?.recommendedValue ?? entry?.recommendedLoadKg ?? null,
            peakOneRm: entry?.strengthPeak?.normalizedOneRm ?? null,
            peakSourceVariationId: entry?.strengthPeak?.sourceVariationId ?? null,
            isDirect: entry?.isDirect === true,
        })),
    });
}

function logFigureEntryPipelineStage(stage, meta = {}) {
    console.debug(`[whichfigure][entry-pipeline] ${stage}`, meta);
}

const SMITH_BENCH_GUIDED_VARIATION_ID = '6922144c1c858345acc2d0ce';
const BENCH_PRESS_VARIATION_ID = '669ced7e665a3ffe77714367';
const BARRE_GUIDEE_VARIATION_ID = '669c3609218324e0b7682ab9';
const SMITH_BENCH_COMBO_SIGNATURE = `${BARRE_GUIDEE_VARIATION_ID}|${BENCH_PRESS_VARIATION_ID}`;
const TUCK_FRONT_LEVER_VARIATION_ID = '692214541c858345acc2d41a';
const FRONT_LEVER_ROOT_VARIATION_ID = '669ced7e665a3ffe77714383';

function isSmithBenchGuidedFigureDebugFocus({
    referenceList = [],
    referenceVariationId = null,
    targetKey = null,
    name = null,
} = {}) {
    const refs = (referenceList || []).map(String);
    const refId = referenceVariationId ? String(referenceVariationId) : null;
    if (refs.includes(SMITH_BENCH_GUIDED_VARIATION_ID) || refId === SMITH_BENCH_GUIDED_VARIATION_ID) {
        return true;
    }
    const key = String(targetKey || '');
    if (key === SMITH_BENCH_GUIDED_VARIATION_ID || key === SMITH_BENCH_COMBO_SIGNATURE) return true;
    const nameNorm = String(name || '').toLowerCase();
    return nameNorm.includes('developpe couche') && (nameNorm.includes('barre guidee') || nameNorm.includes('smith'));
}

function isFrontLeverFigureDebugFocus({
    referenceList = [],
    referenceVariationId = null,
    mainExerciseId = null,
    targetKey = null,
    name = null,
} = {}) {
    const refs = (referenceList || []).map(String);
    const refId = referenceVariationId ? String(referenceVariationId) : null;
    const mainId = mainExerciseId ? String(mainExerciseId) : null;
    if (refs.includes(TUCK_FRONT_LEVER_VARIATION_ID)
        || refId === TUCK_FRONT_LEVER_VARIATION_ID
        || mainId === TUCK_FRONT_LEVER_VARIATION_ID
        || mainId === FRONT_LEVER_ROOT_VARIATION_ID) {
        return true;
    }
    const nameNorm = String(name || '').toLowerCase();
    return nameNorm.includes('front lever');
}

function collectObjectIdsFromFigureEntries(entries = []) {
    const ids = new global.Set();
    for (const entry of entries) {
        for (const id of parseProgressionSignatureToObjectIds(resolveFigureEntryTargetKey(entry))) {
            ids.add(id);
        }
    }
    return [...ids];
}

function resolvePrimaryGraphVariationIdFromSignature(signature, referenceVariationId = null) {
    const ids = parseProgressionSignatureToObjectIds(signature);
    if (!ids.length) return null;
    if (ids.length === 1) return ids[0];
    const ref = referenceVariationId ? String(referenceVariationId) : null;
    if (ref && ids.includes(ref)) return ref;
    const nonRef = ids.find((id) => id !== ref);
    return nonRef || ids[0];
}

async function buildGraphVariationIdByTargetKey(entries, referenceVariationId = null) {
    const byTargetKey = new Map();
    const idsToLoad = new global.Set();
    for (const entry of entries || []) {
        const key = resolveFigureEntryTargetKey(entry);
        for (const id of parseProgressionSignatureToObjectIds(key)) {
            idsToLoad.add(id);
        }
    }
    const variationDocs = idsToLoad.size
        ? await Variation.find(
            { _id: { $in: [...idsToLoad].map((id) => new mongoose.Types.ObjectId(id)) } },
            { _id: 1, isExercice: 1, equivalentTo: 1 },
        ).lean()
        : [];
    const variationById = new Map(variationDocs.map((doc) => [String(doc._id), doc]));
    const equivalentIds = new global.Set();
    for (const doc of variationDocs) {
        for (const eq of doc?.equivalentTo || []) {
            equivalentIds.add(String(eq));
        }
    }
    const equivalentDocs = equivalentIds.size
        ? await Variation.find(
            { _id: { $in: [...equivalentIds].map((id) => new mongoose.Types.ObjectId(id)) } },
            { _id: 1, isExercice: 1 },
        ).lean()
        : [];
    const equivalentById = new Map(equivalentDocs.map((doc) => [String(doc._id), doc]));

    const resolveSoloGraphVariationId = (soloId) => {
        const doc = variationById.get(String(soloId));
        if (doc?.isExercice !== true) return String(soloId);
        const detailId = (doc?.equivalentTo || [])
            .map((id) => String(id))
            .find((eqId) => equivalentById.get(eqId)?.isExercice !== true);
        return detailId || String(soloId);
    };

    for (const entry of entries || []) {
        const key = resolveFigureEntryTargetKey(entry);
        const ids = parseProgressionSignatureToObjectIds(key);
        if (ids.length <= 1) {
            byTargetKey.set(key, resolveSoloGraphVariationId(ids[0] || key));
            continue;
        }
        const exerciseId = ids.find((id) => variationById.get(id)?.isExercice === true);
        byTargetKey.set(
            key,
            exerciseId || resolvePrimaryGraphVariationIdFromSignature(key, referenceVariationId),
        );
    }
    return byTargetKey;
}

function resolveBodyweightPolicyForFigureEntry(entry, bodyweightPolicyById, graphVariationId = null) {
    const graphId = graphVariationId
        || resolvePrimaryGraphVariationIdFromSignature(resolveFigureEntryTargetKey(entry));
    const ids = parseProgressionSignatureToObjectIds(resolveFigureEntryTargetKey(entry));
    if (graphId && bodyweightPolicyById.has(String(graphId))) {
        return bodyweightPolicyById.get(String(graphId));
    }
    for (const id of ids) {
        const policy = bodyweightPolicyById.get(id);
        if (policy?.includeBodyweight) return policy;
    }
    for (const id of ids) {
        const policy = bodyweightPolicyById.get(id);
        if (policy) return policy;
    }
    return { includeBodyweight: false, exerciseBodyWeightRatio: 1 };
}

async function resolveGraphDifficultyScoreForFigureEntry(entry, {
    difficultyScoreByTarget,
    referenceVariationId,
    contextVariationId,
    adjacency,
    graphVariationIdByTargetKey,
}) {
    const targetKey = resolveFigureEntryTargetKey(entry);
    const directScore = difficultyScoreByTarget.get(targetKey);
    if (Number.isFinite(Number(directScore))) return Number(directScore);
    if (entry?.isDirect === true) return 1;
    const graphVarId = graphVariationIdByTargetKey?.get?.(targetKey)
        || resolvePrimaryGraphVariationIdFromSignature(targetKey, referenceVariationId);
    if (graphVarId) {
        const score = difficultyScoreByTarget.get(String(graphVarId));
        if (Number.isFinite(Number(score))) return Number(score);
        const refId = String(referenceVariationId || '');
        if (refId && String(graphVarId) !== refId) {
            const difficulty = await getDifficultyRatio({
                fromVariationId: refId,
                toVariationId: String(graphVarId),
                contextVariationId,
                adjacency
            });
            const ratio = Number(difficulty?.ratio);
            if (Number.isFinite(ratio) && ratio > 0) return ratio;
        }
    }
    return null;
}

async function prepareSignatureAwareFigureContext(payload, normalizedMainExerciseId) {
    const objectIdsForGraph = collectObjectIdsFromFigureEntries(payload.entries);
    const graphVariationIdByTargetKey = await buildGraphVariationIdByTargetKey(
        payload.entries,
        payload.referenceVariationId
    );
    const progressionGraphContextVariationId = payload.progressionGraphContextVariationId
        || payload.mainExerciseId;
    const bodyweightPolicyById = await buildTargetBodyweightPolicyMap(
        objectIdsForGraph,
        normalizedMainExerciseId,
        payload.referenceVariationId,
        progressionGraphContextVariationId
    );
    const adjacency = await buildAdjacencyList({ contextVariationId: progressionGraphContextVariationId });
    const difficultyScoreByTarget = await buildDifficultyScoreByTarget({
        targetIds: objectIdsForGraph,
        referenceVariationId: payload.referenceVariationId,
        contextVariationId: progressionGraphContextVariationId,
        adjacency
    });
    const progressionScopeByTarget = await buildProgressionTargetScopeById(
        objectIdsForGraph,
        progressionGraphContextVariationId
    );
    return {
        objectIdsForGraph,
        graphVariationIdByTargetKey,
        progressionGraphContextVariationId,
        bodyweightPolicyById,
        adjacency,
        difficultyScoreByTarget,
        progressionScopeByTarget,
    };
}

function kgToLbsOrNull(valueKg) {
    const kg = Number(valueKg);
    if (!Number.isFinite(kg)) return null;
    return Math.round((kg * 2.2046226218) * 100) / 100;
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
        // oneRmKg = 1RM total (PDC inclus si applicable), aligné sur whichvalue-figure.
        const wEpley = (oneRmKg / denom) - b;
        if (Number.isFinite(wEpley)) candidates.push(wEpley);
    }

    // Brzycki devient peu fiable sur reps élevées; pour garder la cohérence
    // (ex: 30 reps @ 0kg => recommandation proche de 0kg), on l'ignore > 15 reps.
    if (r <= MAX_BRZYCKI_TARGET_REPS && r < 37) {
        const factor = (37 - r) / 36;
        const wBrzycki = (oneRmKg * factor) - b;
        if (Number.isFinite(wBrzycki)) candidates.push(wBrzycki);
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
    if (!Number.isFinite(loadKg)) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une charge fiable avec les données actuelles.'
        };
    }

    return { success: true, loadKg };
}

function buildFigureTargetLoadInverseBreakdown(oneRmKg, targetUnit, targetValueRaw, weightedBodyweightKg = 0) {
    const rawTarget = Number(targetValueRaw);
    const repsEqTargetRaw = targetUnit === 'seconds'
        ? secondsToEquivalentReps(rawTarget)
        : rawTarget;
    const r = Number.isFinite(repsEqTargetRaw)
        ? Math.min(36, Math.max(1, repsEqTargetRaw))
        : null;
    const b = Number.isFinite(Number(weightedBodyweightKg)) ? Number(weightedBodyweightKg) : 0;
    const oneRm = Number(oneRmKg);
    let wEpley = null;
    let wBrzycki = null;
    let wEpleyTotal = null;
    let wBrzyckiTotal = null;
    if (Number.isFinite(r) && Number.isFinite(oneRm) && oneRm > 0) {
        const denom = 1 + r / 30;
        if (denom > 0) wEpleyTotal = oneRm / denom;
        if (r <= MAX_BRZYCKI_TARGET_REPS && r < 37) {
            const factor = (37 - r) / 36;
            wBrzyckiTotal = oneRm * factor;
        }
    }
    if (Number.isFinite(wEpleyTotal)) wEpley = wEpleyTotal - b;
    if (Number.isFinite(wBrzyckiTotal)) wBrzycki = wBrzyckiTotal - b;
    const candidates = [wEpley, wBrzycki].filter((v) => Number.isFinite(v));
    const avg = candidates.length
        ? candidates.reduce((sum, v) => sum + v, 0) / candidates.length
        : null;
    return {
        targetRepsEquivalent: r,
        weightedBodyweightKgSubtracted: b,
        wEpleyTotalEffective: Number.isFinite(wEpleyTotal) ? Math.round(wEpleyTotal * 1000) / 1000 : null,
        wBrzyckiTotalEffective: Number.isFinite(wBrzyckiTotal) ? Math.round(wBrzyckiTotal * 1000) / 1000 : null,
        wEpleyExternal: Number.isFinite(wEpley) ? Math.round(wEpley * 1000) / 1000 : null,
        wBrzyckiExternal: Number.isFinite(wBrzycki) ? Math.round(wBrzycki * 1000) / 1000 : null,
        brzyckiIncludedInInverse: Number.isFinite(wBrzycki),
        inverseAggregation: candidates.length > 1 ? 'average' : (candidates.length === 1 ? 'single_formula' : 'none'),
        averageBeforeRound: avg != null ? Math.round(avg * 1000) / 1000 : null,
        note: 'Figure path: oneRmForRecommendation total (PDC inclus) ; inverse soustrait le PDC pour la charge externe.',
    };
}

function logWhichweightFigureLoadFormulaDiagnostics(meta = {}) {
    console.debug('[whichfigure][whichweight-load-formula]', {
        apiPath: 'whichweight-figure',
        profileStatsEquivalent: true,
        ...meta,
    });
}

function repsEquivalentToSeconds(repsEquivalentRaw) {
    const repsEquivalent = Number(repsEquivalentRaw);
    if (!Number.isFinite(repsEquivalent) || repsEquivalent <= 0) return null;

    const knots = [
        [0, 0],
        [3, 1],
        [10, 3],
        [30, 7],
        [60, 13.5],
    ];
    for (let i = 0; i < knots.length - 1; i += 1) {
        const [s0, r0] = knots[i];
        const [s1, r1] = knots[i + 1];
        if (repsEquivalent <= r1) {
            if (r1 === r0) return s1;
            const t = (repsEquivalent - r0) / (r1 - r0);
            return s0 + (s1 - s0) * t;
        }
    }

    const n = knots.length;
    const [sPrev, rPrev] = knots[n - 2];
    const [sLast, rLast] = knots[n - 1];
    const slopeRepsPerSec = (rLast - rPrev) / (sLast - sPrev);
    if (!Number.isFinite(slopeRepsPerSec) || slopeRepsPerSec <= 0) return null;
    return sLast + (repsEquivalent - rLast) / slopeRepsPerSec;
}

function resolveReferenceVariationsList(referenceVariations) {
    if (Array.isArray(referenceVariations)) {
        return referenceVariations.map((id) => String(id)).filter(Boolean);
    }
    if (referenceVariations != null && String(referenceVariations).trim()) {
        return [String(referenceVariations).trim()];
    }
    return [];
}

async function augmentDirectEntryPeakWithSessionSets({
    peak,
    userId,
    referenceVariations,
    sessionSets,
    isUnilateral = undefined,
    unilateralSide = undefined,
}) {
    if (!Array.isArray(sessionSets) || sessionSets.length === 0) {
        return { peak, usedSessionSets: 0 };
    }
    const referenceList = resolveReferenceVariationsList(referenceVariations);
    const variationsPayload = referenceList.map((id) => ({ variation: id }));
    const sessionEstimate = await estimateOneRmPeakFromSessionSets({
        userId,
        variations: variationsPayload,
        sessionSets,
        isUnilateral,
        unilateralSide,
    });
    const usedSessionSets = Number(sessionEstimate?.usedSessionSets) || 0;
    const sessionOneRm = Number(sessionEstimate?.oneRmKg);
    if (!Number.isFinite(sessionOneRm) || sessionOneRm <= 0) {
        return { peak, usedSessionSets };
    }
    const sessionPeak = {
        rmKey: 'SESSION',
        normalizedOneRm: sessionOneRm,
        normalizedOneRmRaw: sessionOneRm,
        normalizedOneRmForRecommendation: sessionOneRm,
        normalizedOneRmLbs: kgToLbsOrNull(sessionOneRm),
    };
    const hasHistoricalPeak = peak && Number.isFinite(Number(peak?.normalizedOneRm));
    if (!hasHistoricalPeak) {
        return { peak: sessionPeak, usedSessionSets };
    }
    const prOneRm = Number(peak.normalizedOneRm);
    if (sessionOneRm <= prOneRm) {
        return { peak, usedSessionSets };
    }
    return {
        peak: {
            ...peak,
            ...sessionPeak,
        },
        usedSessionSets,
    };
}

function resolvePeakPrSlotFromEntry(entry, peak) {
    if (!entry?.prs || !peak?.rmKey || !peak?.unit) return null;
    const slot = entry.prs?.[peak.rmKey]?.[peak.unit] ?? null;
    if (!slot?._id) return null;
    if (peak?.setId && String(slot._id) !== String(peak.setId)) return null;
    return slot;
}

function buildForwardOneRmRecommendationBreakdown(peakSlot, peak, weightedBodyweightKg) {
    if (!peakSlot) return null;
    const repsEquivalent = Number.isFinite(Number(peakSlot?.repsEquivalent))
        ? Number(peakSlot.repsEquivalent)
        : Number(peak?.value);
    const difficultyFactor = Number.isFinite(Number(peakSlot?.difficultyFactor))
        && Number(peakSlot.difficultyFactor) > 0
        ? Number(peakSlot.difficultyFactor)
        : 1;
    const scale = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.round(n * difficultyFactor * 100) / 100 : null;
    };
    const brzyckiBwRaw = Number(peakSlot?.brzyckiWithBodyweight ?? peakSlot?.brzycki_with_bodyweight);
    const epleyBwRaw = Number(peakSlot?.epleyWithBodyweight ?? peakSlot?.epley_with_bodyweight);
    const normBrzyckiBw = scale(brzyckiBwRaw);
    const normEpleyBw = scale(epleyBwRaw);
    const useBrzyckiInForward = shouldUseBrzyckiForRepsEquivalent(repsEquivalent);
    const totalLoadAtPeak = Number.isFinite(Number(peak?.weightLoad))
        && Number.isFinite(Number(weightedBodyweightKg))
        ? Number(peak.weightLoad) + Number(weightedBodyweightKg)
        : null;
    const recomputedBrzyckiBw = useBrzyckiInForward
        && Number.isFinite(totalLoadAtPeak)
        && Number.isFinite(repsEquivalent)
        ? scale(estimateOneRepMaxBrzycki(totalLoadAtPeak, repsEquivalent))
        : null;
    const recomputedEpleyBw = Number.isFinite(totalLoadAtPeak) && Number.isFinite(repsEquivalent)
        ? scale(estimateOneRepMaxEpley(totalLoadAtPeak, repsEquivalent))
        : null;
    let aggregation = null;
    let expectedOneRmForRecommendation = null;
    let brzyckiIncludedInForward = false;
    if (useBrzyckiInForward && normBrzyckiBw != null && normEpleyBw != null) {
        const average = Math.round(((normBrzyckiBw + normEpleyBw) / 2) * 100) / 100;
        brzyckiIncludedInForward = shouldIncludeBrzyckiInOneRmAggregate({
            repsEquivalent,
            oneRmCandidateKg: average,
            effectiveLoadKg: totalLoadAtPeak,
        });
        if (brzyckiIncludedInForward) {
            aggregation = 'average_brzycki_epley_with_bodyweight';
            expectedOneRmForRecommendation = average;
        } else {
            aggregation = 'epley_with_bodyweight_only_brzycki_inverse_unreliable';
            expectedOneRmForRecommendation = normEpleyBw;
        }
    } else if (normEpleyBw != null) {
        aggregation = 'epley_with_bodyweight_only';
        expectedOneRmForRecommendation = normEpleyBw;
    } else if (normBrzyckiBw != null) {
        aggregation = 'brzycki_with_bodyweight_only';
        expectedOneRmForRecommendation = normBrzyckiBw;
    }
    return {
        peakRepsEquivalent: Number.isFinite(repsEquivalent) ? repsEquivalent : null,
        brzyckiAllowedInForward: useBrzyckiInForward,
        brzyckiIncludedInForward,
        brzyckiInverseAtPeakLoad: Number.isFinite(totalLoadAtPeak)
            && normBrzyckiBw != null
            && normEpleyBw != null
            ? invertBrzyckiRepsFromOneRm(
                Math.round(((normBrzyckiBw + normEpleyBw) / 2) * 100) / 100,
                totalLoadAtPeak,
            )
            : null,
        difficultyFactor,
        difficultyRatioUsed: peakSlot?.difficultyRatioUsed ?? peak?.difficultyRatioUsed ?? null,
        difficultySourceToTargetRatio: Number.isFinite(Number(peakSlot?.difficultySourceToTargetRatio))
            ? Number(peakSlot.difficultySourceToTargetRatio)
            : (Number.isFinite(Number(peakSlot?.difficultyRatioUsed))
                ? Number(peakSlot.difficultyRatioUsed)
                : null),
        totalLoadAtPeakKg: totalLoadAtPeak,
        brzyckiWithBodyweightRaw: Number.isFinite(brzyckiBwRaw) ? brzyckiBwRaw : null,
        epleyWithBodyweightRaw: Number.isFinite(epleyBwRaw) ? epleyBwRaw : null,
        brzyckiWithBodyweightScaled: normBrzyckiBw,
        epleyWithBodyweightScaled: normEpleyBw,
        recomputedBrzyckiBwFromPeakReps: recomputedBrzyckiBw,
        recomputedEpleyBwFromPeakReps: recomputedEpleyBw,
        normalizedBrzyckiChargeUtile: peakSlot?.normalizedBrzycki ?? peakSlot?.brzycki ?? null,
        normalizedEpleyChargeUtile: peakSlot?.normalizedEpley ?? peakSlot?.epley ?? null,
        normalizedOneRmChargeUtile: peakSlot?.normalizedOneRm ?? null,
        aggregation,
        expectedOneRmForRecommendation,
        storedNormalizedOneRmForRecommendation: peak?.normalizedOneRmForRecommendation ?? null,
    };
}

function buildInverseRecommendationBreakdown(oneRmEffective, targetEffectiveLoad) {
    const rBrzycki = Number.isFinite(oneRmEffective) && Number.isFinite(targetEffectiveLoad) && targetEffectiveLoad > 0
        ? 37 - ((36 * targetEffectiveLoad) / oneRmEffective)
        : null;
    const rEpley = Number.isFinite(oneRmEffective) && Number.isFinite(targetEffectiveLoad) && targetEffectiveLoad > 0
        ? 30 * ((oneRmEffective / targetEffectiveLoad) - 1)
        : null;
    const brzyckiInverseIncluded = Number.isFinite(rBrzycki) && rBrzycki < MAX_BRZYCKI_TARGET_REPS;
    const brzyckiInverseExcludedReason = Number.isFinite(rBrzycki) && !brzyckiInverseIncluded
        ? `rBrzycki=${Math.round(rBrzycki * 100) / 100} >= MAX_BRZYCKI_TARGET_REPS (${MAX_BRZYCKI_TARGET_REPS})`
        : null;
    const candidates = [];
    if (brzyckiInverseIncluded) candidates.push(rBrzycki);
    if (Number.isFinite(rEpley)) candidates.push(rEpley);
    const actualAverage = candidates.length
        ? candidates.reduce((sum, v) => sum + v, 0) / candidates.length
        : null;
    const bothInversesAverage = Number.isFinite(rBrzycki) && Number.isFinite(rEpley)
        ? (rBrzycki + rEpley) / 2
        : null;
    const epleyOnlyReco = Number.isFinite(rEpley)
        ? Math.round(Math.min(36, Math.max(1, rEpley)) * 10) / 10
        : null;
    const bothInversesReco = Number.isFinite(bothInversesAverage)
        ? Math.round(Math.min(36, Math.max(1, bothInversesAverage)) * 10) / 10
        : null;
    return {
        rBrzycki,
        rEpley,
        brzyckiInverseIncluded,
        brzyckiInverseExcludedReason,
        inverseCandidatesUsed: candidates.map((v) => Math.round(v * 1000) / 1000),
        inverseAggregation: candidates.length > 1 ? 'average' : (candidates.length === 1 ? 'single_formula' : 'none'),
        hypotheticalRecoIfBothInversesAveraged: bothInversesReco,
        hypotheticalRecoIfEpleyOnlyInverse: epleyOnlyReco,
        actualAverageBeforeClamp: actualAverage != null ? Math.round(actualAverage * 1000) / 1000 : null,
    };
}

function logZeroKgFigureValueFormulaDiagnostics({
    targetKey,
    name,
    peak,
    peakSlot = null,
    policy,
    userWeightKg,
    effectiveWeightLoad,
    oneRmForRecommendation,
    weightedBodyweightKg,
    includeBodyweight,
    recommendation,
}) {
    const targetExternal = Number(effectiveWeightLoad);
    const bodyweight = Number.isFinite(Number(weightedBodyweightKg)) ? Number(weightedBodyweightKg) : 0;
    const targetEffectiveLoad = targetExternal + bodyweight;
    const oneRmEffective = Number(oneRmForRecommendation);
    const forwardBreakdown = buildForwardOneRmRecommendationBreakdown(peakSlot, peak, bodyweight);
    const inverseBreakdown = buildInverseRecommendationBreakdown(oneRmEffective, targetEffectiveLoad);
    const prRepsAtSameExternalLoad = peak?.weightLoad === targetExternal ? peak?.value ?? null : null;
    const discrepancyVsPrAtSameLoad = (peak?.weightLoad === targetExternal
        && Number.isFinite(Number(peak?.value))
        && Number.isFinite(recommendation?.value))
        ? Number(recommendation.value) - Number(peak.value)
        : null;
    let rootCauseSummary = null;
    if (Number.isFinite(discrepancyVsPrAtSameLoad) && Math.abs(discrepancyVsPrAtSameLoad) > 0.05) {
        if (forwardBreakdown?.brzyckiIncludedInForward === false
            && forwardBreakdown?.brzyckiAllowedInForward === true) {
            rootCauseSummary = 'Forward: Epley seul car inverse Brzycki à la charge d’évaluation >= MAX_BRZYCKI_TARGET_REPS (même règle que l’inverse).';
        } else if (forwardBreakdown?.brzyckiAllowedInForward && !inverseBreakdown?.brzyckiInverseIncluded) {
            rootCauseSummary = 'Écart résiduel forward/inverse — voir forwardBreakdown et inverseBreakdown.';
        } else if (!forwardBreakdown?.brzyckiAllowedInForward) {
            rootCauseSummary = 'Forward: Epley seul (reps PR >= 15). Inverse: Epley seul.';
        } else {
            rootCauseSummary = 'Écart forward/inverse ou normalisation difficulté — voir forwardBreakdown et inverseBreakdown.';
        }
    } else if (Number.isFinite(discrepancyVsPrAtSameLoad) && Math.abs(discrepancyVsPrAtSameLoad) <= 0.05) {
        rootCauseSummary = 'Cohérent: reco @ même charge externe ≈ PR brut.';
    }
    console.debug('[whichfigure][zero-kg-value-formula]', {
        targetKey,
        name: name?.fr || name?.en || name || null,
        effectiveWeightLoadExternal: targetExternal,
        weightedBodyweightKg: bodyweight,
        targetEffectiveLoadTotal: targetEffectiveLoad,
        includeBodyweightInFormula: includeBodyweight === true,
        userWeightKg: Number.isFinite(Number(userWeightKg)) ? Number(userWeightKg) : null,
        exerciseBodyWeightRatio: policy?.exerciseBodyWeightRatio ?? null,
        peakRmKey: peak?.rmKey ?? null,
        peakSetId: peak?.setId ?? null,
        peakRawReps: peak?.value ?? null,
        peakWeightLoadExternal: peak?.weightLoad ?? null,
        peakNormalizedOneRm: peak?.normalizedOneRm ?? null,
        peakNormalizedOneRmRaw: peak?.normalizedOneRmRaw ?? null,
        peakNormalizedOneRmForRecommendation: peak?.normalizedOneRmForRecommendation ?? null,
        peakDifficultyRatioUsed: peak?.difficultyRatioUsed ?? null,
        peakSourceVariationId: peak?.sourceVariationId ?? null,
        peakTargetVariationId: peak?.targetVariationId ?? null,
        peakExtrapolated: peak?.extrapolated === true,
        oneRmUsedForInverseFormula: oneRmEffective,
        forwardBreakdown,
        inverseBreakdown,
        recommendedValue: recommendation?.value ?? null,
        recommendationSuccess: recommendation?.success === true,
        prRepsAtSameExternalLoad,
        discrepancyVsPrAtSameLoad,
        rootCauseSummary,
    });
}

function resolveOneRmForFigureRecommendation({
    peak,
    peakSlot = null,
    includeBodyweight = false,
    weightedBodyweightKg = 0,
    externalEffectiveLoadKg = 0,
}) {
    const repsEquivalent = Number.isFinite(Number(peakSlot?.repsEquivalent))
        ? Number(peakSlot.repsEquivalent)
        : Number(peak?.value);
    const difficultyFactor = Number.isFinite(Number(peakSlot?.difficultyFactor))
        && Number(peakSlot.difficultyFactor) > 0
        ? Number(peakSlot.difficultyFactor)
        : 1;
    const externalLoad = Number(externalEffectiveLoadKg);
    const weightedBw = Number(weightedBodyweightKg);
    const effectiveLoadKgForBrzyckiCheck = includeBodyweight && weightedBw > 0
        ? (Number.isFinite(externalLoad) ? externalLoad : 0) + weightedBw
        : (Number.isFinite(Number(peakSlot?.normalizedEffectiveWeightLoad))
            ? Number(peakSlot.normalizedEffectiveWeightLoad)
            : externalLoad);

    const resolved = resolveNormalizedOneRmForRecommendation({
        normalizedOneRm: peak?.normalizedOneRm,
        brzyckiWithBodyweight: peakSlot?.brzyckiWithBodyweight ?? peakSlot?.brzycki_with_bodyweight,
        epleyWithBodyweight: peakSlot?.epleyWithBodyweight ?? peakSlot?.epley_with_bodyweight,
        normalizedBrzycki: peakSlot?.normalizedBrzycki ?? peakSlot?.brzycki,
        normalizedEpley: peakSlot?.normalizedEpley ?? peakSlot?.epley,
        weightedBodyweightKg: weightedBw,
        repsEquivalent,
        difficultyFactor,
        includeBodyweight,
        externalEffectiveLoadKg: externalLoad,
        effectiveLoadKgForBrzyckiCheck,
    });

    return Number.isFinite(resolved) && resolved > 0
        ? resolved
        : Number(peak?.normalizedOneRmForRecommendation ?? peak?.normalizedOneRm);
}

function computeTargetValueFromOneRm(oneRmKg, targetUnit, effectiveWeightLoadRaw, weightedBodyweightKg = 0) {
    return computeRecommendedValueFromOneRmEstimate(
        oneRmKg,
        targetUnit,
        effectiveWeightLoadRaw,
        weightedBodyweightKg,
        null,
        repsEquivalentToSeconds,
    );
}

function collectBestPeakFromDetailedPrs(prs) {
    if (!prs || typeof prs !== 'object') return null;
    const keys = Object.keys(prs).filter((k) => k === 'Last' || /^\d+RM$/.test(k));
    let best = null;
    for (const key of keys) {
        for (const unitKey of ['repetitions', 'seconds']) {
            const set = prs?.[key]?.[unitKey];
            const normalizedOneRmRaw = Number(set?.normalizedOneRm);
            const normalizedEpley = Number(set?.normalizedEpley);
            const rawValue = Number(set?.value);
            const normalizedOneRm = Number.isFinite(rawValue)
                && rawValue > 15
                && Number.isFinite(normalizedEpley)
                && normalizedEpley > 0
                ? normalizedEpley
                : normalizedOneRmRaw;
            if (!Number.isFinite(normalizedOneRm) || normalizedOneRm <= 0) continue;
            const repsEquivalent = Number.isFinite(Number(set?.repsEquivalent))
                ? Number(set.repsEquivalent)
                : rawValue;
            const userWeightKg = Number(set?.oneRepMaxUserWeightKg);
            const bodyweightRatio = Number(set?.oneRepMaxExerciseBodyWeightRatio);
            const weightedBodyweightKg = set?.oneRepMaxIncludesBodyweight === true
                && Number.isFinite(userWeightKg)
                && userWeightKg > 0
                && Number.isFinite(bodyweightRatio)
                ? userWeightKg * bodyweightRatio
                : 0;
            const peakExternalLoad = Number.isFinite(Number(set?.weightLoad)) ? Number(set.weightLoad) : 0;
            const normalizedOneRmForRecommendation = resolveNormalizedOneRmForRecommendation({
                normalizedOneRm,
                brzyckiWithBodyweight: set?.brzyckiWithBodyweight ?? set?.brzycki_with_bodyweight,
                epleyWithBodyweight: set?.epleyWithBodyweight ?? set?.epley_with_bodyweight,
                normalizedBrzycki: set?.normalizedBrzycki ?? set?.brzycki,
                normalizedEpley: set?.normalizedEpley ?? set?.epley,
                weightedBodyweightKg,
                repsEquivalent,
                difficultyFactor: set?.difficultyFactor ?? 1,
                includeBodyweight: set?.oneRepMaxIncludesBodyweight === true,
                externalEffectiveLoadKg: peakExternalLoad,
                effectiveLoadKgForBrzyckiCheck: peakExternalLoad + weightedBodyweightKg,
            });
            if (!Number.isFinite(normalizedOneRmForRecommendation) || normalizedOneRmForRecommendation <= 0) continue;
            if (!best || normalizedOneRm > Number(best.normalizedOneRm)) {
                best = {
                    rmKey: key,
                    unit: unitKey,
                    setId: set?._id != null ? String(set._id) : null,
                    date: set?.date || null,
                    value: toNumberOrNull(set?.value),
                    weightLoad: toNumberOrNull(set?.weightLoad),
                    normalizedOneRm: toRounded(normalizedOneRm, 3),
                    normalizedOneRmForRecommendation: toRounded(normalizedOneRmForRecommendation, 3),
                    normalizedOneRmRaw: toRounded(normalizedOneRmRaw, 3),
                    normalizedEpleyUsedForPeak: Number.isFinite(rawValue)
                        && rawValue > 15
                        && Number.isFinite(normalizedEpley)
                        && normalizedEpley > 0,
                    normalizedEpley: Number.isFinite(normalizedEpley) ? toRounded(normalizedEpley, 3) : null,
                    normalizedOneRmLbs: toRounded(kgToLbsOrNull(normalizedOneRm), 2),
                    normalizedEffectiveWeightLoad: toNumberOrNull(set?.normalizedEffectiveWeightLoad),
                    difficultyRatioUsed: toNumberOrNull(set?.difficultyRatioUsed),
                    sourceVariationId: set?.sourceVariationId ? String(set.sourceVariationId) : null,
                    targetVariationId: set?.targetVariationId ? String(set.targetVariationId) : null,
                    path: Array.isArray(set?.path) ? set.path.map((id) => String(id)) : [],
                    pathNames: Array.isArray(set?.pathNames) ? set.pathNames : [],
                    hops: Number.isFinite(Number(set?.hops)) ? Number(set.hops) : null
                };
            }
        }
    }
    return best;
}

function pickAnchorPeakFromEntries(entries) {
    if (!Array.isArray(entries)) return { anchorPeak: null, anchorVariationId: null };
    const directEntry = entries.find((e) => e?.isDirect === true);
    const directPeak = directEntry ? collectBestPeakFromDetailedPrs(directEntry?.prs) : null;
    if (directPeak) {
        return { anchorPeak: directPeak, anchorVariationId: String(directEntry.variationId) };
    }

    let best = null;
    let bestVariationId = null;
    for (const entry of entries) {
        const peak = collectBestPeakFromDetailedPrs(entry?.prs);
        if (!peak) continue;
        if (!best || Number(peak.normalizedOneRm) > Number(best.normalizedOneRm)) {
            best = peak;
            bestVariationId = String(entry.variationId);
        }
    }
    return { anchorPeak: best, anchorVariationId: bestVariationId };
}

function getAnchorCandidatesFromEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const candidates = [];
    for (const entry of entries) {
        const peak = collectBestPeakFromDetailedPrs(entry?.prs);
        if (!peak || !Number.isFinite(Number(peak.normalizedOneRm))) continue;
        candidates.push({
            variationId: String(entry.variationId),
            peak,
            isDirect: entry?.isDirect === true
        });
    }
    candidates.sort((a, b) => {
        if (a.isDirect && !b.isDirect) return -1;
        if (!a.isDirect && b.isDirect) return 1;
        return Number(b.peak.normalizedOneRm) - Number(a.peak.normalizedOneRm);
    });
    return candidates;
}

function getUsedHistoricalSetsFromDetailedPrs(prs) {
    if (!prs || typeof prs !== 'object') return 0;
    const ids = new global.Set();
    for (const key of Object.keys(prs)) {
        const rep = prs?.[key]?.repetitions;
        const sec = prs?.[key]?.seconds;
        if (rep?._id != null) ids.add(String(rep._id));
        if (sec?._id != null) ids.add(String(sec._id));
    }
    return ids.size;
}

function getRecommendationDifficultyScore(recommendation) {
    const explicitDifficulty = Number(recommendation?.difficultyScore);
    if (Number.isFinite(explicitDifficulty) && explicitDifficulty > 0) return explicitDifficulty;
    const ratio = Number(recommendation?.strengthPeak?.difficultyRatioUsed);
    if (Number.isFinite(ratio) && ratio > 0) return ratio;
    if (recommendation?.isDirect === true) return 1;
    return Number.POSITIVE_INFINITY;
}

function getRecommendationLoadScore(recommendation) {
    const external = Number(recommendation?.recommendedLoadKg);
    if (Number.isFinite(external)) return external;
    const effective = Number(recommendation?.recommendedEffectiveWeightLoadKg);
    if (Number.isFinite(effective)) return effective;
    return Number.POSITIVE_INFINITY;
}

function getProgressionScopeSortRank(recommendation) {
    const scope = recommendation?.progressionScope;
    if (scope === 'generic' || recommendation?.isGenericProgressionTarget === true) return 2;
    if (scope === 'mixed') return 1;
    return 0;
}

function sortRecommendationsByRecommendedLoadDescending(recommendations) {
    if (!Array.isArray(recommendations)) return [];
    const sorted = [...recommendations].sort((a, b) => {
        if (a?.isDirect === true && b?.isDirect !== true) return -1;
        if (b?.isDirect === true && a?.isDirect !== true) return 1;

        const scopeRankDiff = getProgressionScopeSortRank(a) - getProgressionScopeSortRank(b);
        if (scopeRankDiff !== 0) return scopeRankDiff;

        if (a?.success !== false && b?.success === false) return -1;
        if (b?.success !== false && a?.success === false) return 1;

        const aDifficulty = getRecommendationDifficultyScore(a);
        const bDifficulty = getRecommendationDifficultyScore(b);
        if (aDifficulty !== bDifficulty) return aDifficulty - bDifficulty;

        const aValue = Number(a?.recommendedValue);
        const bValue = Number(b?.recommendedValue);
        const aHasValue = Number.isFinite(aValue);
        const bHasValue = Number.isFinite(bValue);
        if (aHasValue && bHasValue && aValue !== bValue) return bValue - aValue;
        if (aHasValue && !bHasValue) return -1;
        if (!aHasValue && bHasValue) return 1;

        const aLoad = getRecommendationLoadScore(a);
        const bLoad = getRecommendationLoadScore(b);
        const aHasLoad = Number.isFinite(aLoad);
        const bHasLoad = Number.isFinite(bLoad);
        if (aHasLoad && !bHasLoad) return -1;
        if (!aHasLoad && bHasLoad) return 1;
        if (aHasLoad && bHasLoad && aLoad !== bLoad) return bLoad - aLoad;

        const aName = typeof a?.name === 'string'
            ? a.name
            : (a?.name?.fr || a?.name?.en || '');
        const bName = typeof b?.name === 'string'
            ? b.name
            : (b?.name?.fr || b?.name?.en || '');
        return aName.localeCompare(bName);
    });
    return sorted;
}

function normalizeFigureName(name) {
    if (typeof name !== 'string') return '';
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function pickPreferredDuplicateFigureEntry(current, candidate) {
    const currentKey = resolveFigureEntryTargetKey(current);
    const candidateKey = resolveFigureEntryTargetKey(candidate);
    const currentIsSignature = currentKey.includes('|');
    const candidateIsSignature = candidateKey.includes('|');

    if (current?.isDirect === true && candidate?.isDirect !== true) return current;
    if (candidate?.isDirect === true && current?.isDirect !== true) return candidate;

    const currentSets = getUsedHistoricalSetsFromDetailedPrs(current?.prs);
    const candidateSets = getUsedHistoricalSetsFromDetailedPrs(candidate?.prs);
    if (candidateSets !== currentSets) {
        return candidateSets > currentSets ? candidate : current;
    }

    if (!currentIsSignature && candidateIsSignature) return current;
    if (currentIsSignature && !candidateIsSignature) return candidate;

    if (currentIsSignature && candidateIsSignature) {
        return candidateKey.length > currentKey.length ? candidate : current;
    }

    return current;
}

function rebuildEntriesFromDedupeOrder(entries, bestByKey, keyForEntry, pickPreferred = pickPreferredDuplicateFigureEntry) {
    const order = [];
    for (const entry of entries) {
        const dedupeKey = keyForEntry(entry);
        if (!dedupeKey) {
            order.push({ dedupeKey: null, entry });
            continue;
        }
        if (!bestByKey.has(dedupeKey)) {
            bestByKey.set(dedupeKey, entry);
            order.push({ dedupeKey });
            continue;
        }
        bestByKey.set(dedupeKey, pickPreferred(bestByKey.get(dedupeKey), entry));
    }

    const seenDedupeKeys = new global.Set();
    const result = [];
    for (const row of order) {
        if (!row.dedupeKey) {
            result.push(row.entry);
            continue;
        }
        if (seenDedupeKeys.has(row.dedupeKey)) continue;
        seenDedupeKeys.add(row.dedupeKey);
        result.push(bestByKey.get(row.dedupeKey));
    }
    return result;
}

function resolveFigureRecommendationTargetKey(entry) {
    return resolveFigureEntryTargetKey(entry) || null;
}

function dedupeEntriesByTargetKey(entries, pickPreferred = pickPreferredDuplicateFigureEntry) {
    if (!Array.isArray(entries) || entries.length <= 1) return entries;
    const bestByTargetKey = new Map();
    return rebuildEntriesFromDedupeOrder(
        entries,
        bestByTargetKey,
        (entry) => resolveFigureEntryTargetKey(entry) || null,
        pickPreferred,
    );
}

function getUsedHistoricalSetsFromRecommendation(recommendation) {
    const used = Number(recommendation?.usedSets?.usedHistoricalSets);
    return Number.isFinite(used) ? used : 0;
}

function pickPreferredDuplicateFigureRecommendation(current, candidate) {
    if (current?.isDirect === true && candidate?.isDirect !== true) return current;
    if (candidate?.isDirect === true && current?.isDirect !== true) return candidate;

    const currentSets = getUsedHistoricalSetsFromRecommendation(current);
    const candidateSets = getUsedHistoricalSetsFromRecommendation(candidate);
    if (candidateSets !== currentSets) {
        return candidateSets > currentSets ? candidate : current;
    }

    if (current?.success === true && candidate?.success !== true) return current;
    if (candidate?.success === true && current?.success !== true) return candidate;

    const currentKey = String(current?.variationId || current?.variationSignature || '');
    const candidateKey = String(candidate?.variationId || candidate?.variationSignature || '');
    const currentIsSignature = currentKey.includes('|');
    const candidateIsSignature = candidateKey.includes('|');
    if (!currentIsSignature && candidateIsSignature) return current;
    if (currentIsSignature && !candidateIsSignature) return candidate;

    return current;
}

function dedupeFigureRecommendationsByTargetKey(recommendations) {
    if (!Array.isArray(recommendations) || recommendations.length <= 1) return recommendations;
    const bestByTargetKey = new Map();
    return rebuildEntriesFromDedupeOrder(
        recommendations,
        bestByTargetKey,
        (entry) => resolveFigureRecommendationTargetKey(entry),
        pickPreferredDuplicateFigureRecommendation,
    );
}

function buildImplicitFullFallbackRecommendations(recommendations) {
    if (!Array.isArray(recommendations)) return [];
    const normalized = recommendations.map((r) => ({
        rec: r,
        normalizedName: normalizeFigureName(r?.name?.fr || r?.name?.en || null)
    }));

    return recommendations.map((rec) => {
        if (rec?.isDirect !== true || rec?.success === true) return rec;
        const directName = normalizeFigureName(rec?.name?.fr || rec?.name?.en || null);
        if (!directName || directName.includes('full') || directName.includes('complet')) return rec;
        const fallback = normalized
            .filter((item) => {
                if (item?.rec?.success !== true) return false;
                if (item?.rec?.isDirect === true) return false;
                if (!item.normalizedName) return false;
                const hasFull = item.normalizedName.includes('full') || item.normalizedName.includes('complet');
                if (!hasFull) return false;
                return item.normalizedName.includes(directName);
            })
            .sort((a, b) => {
                const aLoad = getRecommendationLoadScore(a.rec);
                const bLoad = getRecommendationLoadScore(b.rec);
                const aHas = Number.isFinite(aLoad);
                const bHas = Number.isFinite(bLoad);
                if (aHas && !bHas) return -1;
                if (!aHas && bHas) return 1;
                if (aHas && bHas && aLoad !== bLoad) return bLoad - aLoad;
                return getRecommendationDifficultyScore(a.rec) - getRecommendationDifficultyScore(b.rec);
            })[0]?.rec;
        if (!fallback) return rec;
        return {
            ...rec,
            success: true,
            reason: null,
            message: null,
            recommendedLoadKg: fallback.recommendedLoadKg,
            recommendedEffectiveWeightLoadKg: fallback.recommendedEffectiveWeightLoadKg,
            recommendedLoadLbs: fallback.recommendedLoadLbs,
            recommendedTotalLoadKg: fallback.recommendedTotalLoadKg,
            bodyweight: fallback.bodyweight,
            usedSets: fallback.usedSets,
            strengthPeak: fallback.strengthPeak,
            difficultyScore: fallback.difficultyScore,
            implicitFromVariationId: fallback.variationId
        };
    });
}

async function extrapolatePeakFromAnchor({
    anchorPeak,
    anchorVariationId,
    targetVariationId,
    contextVariationId,
    adjacency
}) {
    if (!anchorPeak || !anchorVariationId || !targetVariationId) return null;
    if (String(anchorVariationId) === String(targetVariationId)) return anchorPeak;
    const difficulty = await getDifficultyRatio({
        fromVariationId: anchorVariationId,
        toVariationId: targetVariationId,
        contextVariationId,
        adjacency
    });
    const ratio = Number(difficulty?.ratio);
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const normalizedOneRm = Number(anchorPeak.normalizedOneRm) * (1 / ratio);
    if (!Number.isFinite(normalizedOneRm) || normalizedOneRm <= 0) return null;
    const anchorReco = Number(anchorPeak.normalizedOneRmForRecommendation ?? anchorPeak.normalizedOneRm);
    const normalizedOneRmForRecommendation = Number.isFinite(anchorReco)
        ? anchorReco * (1 / ratio)
        : normalizedOneRm;
    return {
        rmKey: 'EXTRAPOLATED',
        unit: anchorPeak?.unit || 'repetitions',
        setId: anchorPeak?.setId || null,
        date: anchorPeak?.date || null,
        value: anchorPeak?.value ?? null,
        weightLoad: anchorPeak?.weightLoad ?? null,
        normalizedOneRm: toRounded(normalizedOneRm, 3),
        normalizedOneRmForRecommendation: toRounded(normalizedOneRmForRecommendation, 3),
        normalizedOneRmRaw: null,
        normalizedOneRmLbs: toRounded(kgToLbsOrNull(normalizedOneRm), 2),
        normalizedEffectiveWeightLoad: null,
        difficultyRatioUsed: ratio,
        sourceVariationId: String(anchorVariationId),
        targetVariationId: String(targetVariationId),
        path: Array.isArray(difficulty?.path) ? difficulty.path.map((id) => String(id)) : [],
        pathNames: [],
        hops: Number.isFinite(Number(difficulty?.hops)) ? Number(difficulty.hops) : null,
        extrapolated: true
    };
}

/**
 * Classifie les cibles du graphe: "generic" = paliers génériques (edges sans contexte exercice),
 * "exercise" = liés au contextVariationId courant (ex. advanced tuck front lever).
 */
async function buildProgressionTargetScopeById(targetIds, progressionGraphContextVariationId) {
    const byId = new Map();
    const uniq = [...new global.Set((targetIds || []).map((id) => String(id)).filter(Boolean))];
    if (!uniq.length) return byId;

    const contextId = (progressionGraphContextVariationId != null
        && mongoose.Types.ObjectId.isValid(String(progressionGraphContextVariationId)))
        ? String(progressionGraphContextVariationId)
        : null;

    const objectIds = uniq
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    const variationDocs = objectIds.length
        ? await Variation.find({ _id: { $in: objectIds } }, { _id: 1, isExercice: 1 }).lean()
        : [];
    const variationById = new Map(variationDocs.map((doc) => [String(doc._id), doc]));

    const exerciseScopedIds = new global.Set();
    const genericGraphIds = new global.Set();

    if (objectIds.length) {
        const edges = await VariationProgressionEdge.find(
            {
                isActive: true,
                $or: [
                    { fromVariationId: { $in: objectIds } },
                    { toVariationId: { $in: objectIds } }
                ]
            },
            { fromVariationId: 1, toVariationId: 1, contextVariationId: 1 }
        ).lean();

        for (const edge of edges) {
            const edgeContextId = edge?.contextVariationId != null
                ? String(edge.contextVariationId)
                : null;
            const involved = [edge?.fromVariationId, edge?.toVariationId]
                .map((id) => (id != null ? String(id) : null))
                .filter(Boolean);
            for (const id of involved) {
                if (!uniq.includes(id)) continue;
                if (edgeContextId === null) genericGraphIds.add(id);
                if (contextId && edgeContextId === contextId) exerciseScopedIds.add(id);
            }
        }
    }

    for (const id of uniq) {
        const doc = variationById.get(id);
        if (doc?.isExercice === true) {
            byId.set(id, { progressionScope: 'exercise', isGenericProgressionTarget: false });
            continue;
        }
        const onExerciseGraph = exerciseScopedIds.has(id);
        const onGenericGraph = genericGraphIds.has(id);
        let progressionScope = 'exercise';
        if (onGenericGraph && !onExerciseGraph) progressionScope = 'generic';
        else if (onGenericGraph && onExerciseGraph) progressionScope = 'mixed';
        byId.set(id, {
            progressionScope,
            isGenericProgressionTarget: progressionScope === 'generic',
        });
    }
    return byId;
}

async function buildDifficultyScoreByTarget({
    targetIds,
    referenceVariationId,
    contextVariationId,
    adjacency
}) {
    const byTarget = new Map();
    const referenceId = String(referenceVariationId || '');
    if (!Array.isArray(targetIds) || !targetIds.length || !referenceId) return byTarget;
    await Promise.all(targetIds.map(async (targetIdRaw) => {
        const targetId = String(targetIdRaw || '');
        if (!targetId) return;
        if (targetId === referenceId) {
            byTarget.set(targetId, 1);
            return;
        }
        const difficulty = await getDifficultyRatio({
            fromVariationId: referenceId,
            toVariationId: targetId,
            contextVariationId,
            adjacency
        });
        const ratio = Number(difficulty?.ratio);
        if (Number.isFinite(ratio) && ratio > 0) {
            byTarget.set(targetId, ratio);
        }
    }));
    return byTarget;
}

async function buildTargetBodyweightPolicyMap(
    targetIds,
    normalizedMainExerciseId = null,
    referenceVariationId = null,
    progressionGraphEdgeContextVariationId = null
) {
    const uniq = [...new global.Set((targetIds || []).map((id) => String(id)).filter(isValidObjectIdString))];
    if (!uniq.length) return new Map();
    const objectIds = uniq.map((id) => new mongoose.Types.ObjectId(id));
    const docs = await Variation.find(
        { _id: { $in: objectIds } },
        { _id: 1, isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1, equivalentTo: 1 }
    ).lean();
    const equivalentIds = [...new global.Set(
        docs.flatMap((doc) => (Array.isArray(doc?.equivalentTo) ? doc.equivalentTo : []))
            .map((id) => String(id))
            .filter(Boolean)
    )];
    const equivalentDocs = equivalentIds.length
        ? await Variation.find(
            { _id: { $in: equivalentIds } },
            { _id: 1, isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 }
        ).lean()
        : [];
    const equivalentDocById = new Map(equivalentDocs.map((doc) => [String(doc._id), doc]));
    const graphDetailLikeIds = new global.Set();
    const edgeContextVariationId = (progressionGraphEdgeContextVariationId != null
        && mongoose.Types.ObjectId.isValid(String(progressionGraphEdgeContextVariationId)))
        ? String(progressionGraphEdgeContextVariationId)
        : normalizedMainExerciseId;
    if (edgeContextVariationId) {
        const edges = await VariationProgressionEdge.find(
            {
                isActive: true,
                isExerciseVariation: false,
                $and: [
                    {
                        $or: [
                            { contextVariationId: edgeContextVariationId },
                            { contextVariationId: null }
                        ]
                    },
                    {
                        $or: [
                            { fromVariationId: { $in: objectIds } },
                            { toVariationId: { $in: objectIds } }
                        ]
                    }
                ]
            },
            { fromVariationId: 1, toVariationId: 1 }
        ).lean();
        for (const edge of edges) {
            if (edge?.fromVariationId) graphDetailLikeIds.add(String(edge.fromVariationId));
            if (edge?.toVariationId) graphDetailLikeIds.add(String(edge.toVariationId));
        }
    }
    const docById = new Map(docs.map((doc) => [String(doc._id), doc]));
    let mainDoc = normalizedMainExerciseId ? docById.get(String(normalizedMainExerciseId)) : null;
    if (!mainDoc && normalizedMainExerciseId) {
        mainDoc = await Variation.findById(
            String(normalizedMainExerciseId),
            { _id: 1, isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 }
        ).lean();
    }
    let referenceDoc = referenceVariationId ? docById.get(String(referenceVariationId)) : null;
    if (!referenceDoc && referenceVariationId) {
        referenceDoc = await Variation.findById(
            String(referenceVariationId),
            { _id: 1, isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 }
        ).lean();
    }
    const mainPolicy = mainDoc
        ? {
            includeBodyweight: shouldIncludeBodyweightForVariationDocs([mainDoc]),
            exerciseBodyWeightRatio: getExerciseBodyWeightRatioForVariationDocs([mainDoc])
        }
        : { includeBodyweight: false, exerciseBodyWeightRatio: 1 };
    const referencePolicy = referenceDoc
        ? {
            includeBodyweight: shouldIncludeBodyweightForVariationDocs([referenceDoc]),
            exerciseBodyWeightRatio: getExerciseBodyWeightRatioForVariationDocs([referenceDoc])
        }
        : mainPolicy;
    const byId = new Map();
    for (const doc of docs) {
        const docId = String(doc._id);
        const selfIncludeBodyweight = shouldIncludeBodyweightForVariationDocs([doc]);
        const selfRatio = getExerciseBodyWeightRatioForVariationDocs([doc]);
        let includeBodyweight = shouldIncludeBodyweightForVariationDocs([doc]);
        let ratio = getExerciseBodyWeightRatioForVariationDocs([doc]);
        const equivalentExerciseDoc = (Array.isArray(doc?.equivalentTo) ? doc.equivalentTo : [])
            .map((id) => equivalentDocById.get(String(id)))
            .find((d) => d?.isExercice === true);
        const equivalentIncludeBodyweight = equivalentExerciseDoc
            ? shouldIncludeBodyweightForVariationDocs([equivalentExerciseDoc])
            : null;
        const equivalentRatio = equivalentExerciseDoc
            ? getExerciseBodyWeightRatioForVariationDocs([equivalentExerciseDoc])
            : null;
        const usedEquivalentExercisePolicy = Boolean(equivalentExerciseDoc);
        if (usedEquivalentExercisePolicy) {
            includeBodyweight = equivalentIncludeBodyweight;
            ratio = equivalentRatio;
        }
        // En contexte "figure", les variations détail (non exercice) héritent
        // de la policy bodyweight du main exercise de la famille.
        const inheritedFromReference = (doc?.isExercice !== true || graphDetailLikeIds.has(docId)) && normalizedMainExerciseId;
        if (inheritedFromReference && !usedEquivalentExercisePolicy) {
            includeBodyweight = referencePolicy.includeBodyweight;
            ratio = referencePolicy.exerciseBodyWeightRatio;
        }
        byId.set(docId, {
            includeBodyweight,
            exerciseBodyWeightRatio: ratio
        });
    }
    return byId;
}

function buildFamilyAlternateEquipmentIds(progressionPayload, mainRootId) {
    const ids = new global.Set();
    const mainRoot = mainRootId ? String(mainRootId) : null;
    if (!mainRoot) return ids;

    const signatures = new global.Set();
    const familyScopeDebug = progressionPayload?.meta?.familyScopeDebug;
    for (const sig of familyScopeDebug?.sampleSignatures || []) {
        if (sig) signatures.add(String(sig));
    }
    for (const entry of progressionPayload?.entries || []) {
        const key = resolveFigureEntryTargetKey(entry);
        if (key.includes('|')) signatures.add(key);
    }

    for (const sig of signatures) {
        const parts = parseProgressionSignatureToObjectIds(sig);
        if (!parts.includes(mainRoot)) continue;
        parts.forEach((id) => {
            if (id !== mainRoot) ids.add(id);
        });
    }
    return ids;
}

async function buildContextualReferenceExerciseMergeMeta({
    referenceVariationId,
    normalizedMainExerciseId,
    referenceVariationSignature,
    progressionPayload,
    figurePayload = null,
    referenceVariationIds = [],
}) {
    const mainRootId = normalizedMainExerciseId ? String(normalizedMainExerciseId) : null;
    const mainDoc = mainRootId
        ? await Variation.findById(mainRootId, { name: 1 }).lean()
        : null;
    const mainRootName = mainDoc?.name || null;

    const figureEntries = Array.isArray(figurePayload?.entries) ? figurePayload.entries : [];
    const progressionEntries = Array.isArray(progressionPayload?.entries) ? progressionPayload.entries : [];
    const targetKeys = new global.Set();
    for (const entry of [...figureEntries, ...progressionEntries]) {
        const key = resolveFigureEntryTargetKey(entry);
        if (key && !key.includes('|') && isValidObjectIdString(key)) {
            targetKeys.add(key);
        }
    }
    for (const signature of progressionPayload?.meta?.familyScopeDebug?.sampleSignatures || []) {
        for (const part of parseProgressionSignatureToObjectIds(String(signature))) {
            if (isValidObjectIdString(part)) targetKeys.add(part);
        }
    }
    if (referenceVariationSignature?.includes('|')) {
        for (const part of parseProgressionSignatureToObjectIds(String(referenceVariationSignature))) {
            if (isValidObjectIdString(part)) targetKeys.add(part);
        }
    }
    for (const id of referenceVariationIds || []) {
        const normalized = String(id || '').trim();
        if (isValidObjectIdString(normalized)) targetKeys.add(normalized);
    }
    const isExerciseByTargetKey = new Map();
    const variationNameById = new Map();
    const unilateralDetailIds = new global.Set();
    if (targetKeys.size > 0) {
        const docs = await Variation.find(
            { _id: { $in: [...targetKeys].map((id) => new mongoose.Types.ObjectId(id)) } },
            { isExercice: 1, isUnilateral: 1, name: 1 },
        ).lean();
        for (const doc of docs) {
            const id = String(doc._id);
            isExerciseByTargetKey.set(id, doc?.isExercice === true);
            if (doc?.name) variationNameById.set(id, doc.name);
            if (doc?.isUnilateral === true) unilateralDetailIds.add(id);
        }
    }
    for (const entry of figureEntries) {
        const key = resolveFigureEntryTargetKey(entry);
        if (key && entry?.isTargetExercise === true) {
            isExerciseByTargetKey.set(key, true);
        } else if (key && entry?.isTargetExercise === false) {
            isExerciseByTargetKey.set(key, false);
        }
    }

    const refId = referenceVariationId ? String(referenceVariationId) : null;
    if (!refId || !isValidObjectIdString(refId)) {
        return {
            isContextualCombinedExercise: false,
            mainRootId,
            mainRootName,
            isExerciseByTargetKey,
            variationNameById,
            referenceVariationIds: (referenceVariationIds || []).map((id) => String(id)).filter(Boolean),
            unilateralDetailIds,
        };
    }
    const refDoc = await Variation.findById(refId, { isExercice: 1, equivalentTo: 1, name: 1, isUnilateral: 1 }).lean();
    if (refDoc?.isUnilateral === true) unilateralDetailIds.add(refId);
    const equivalentIds = (refDoc?.equivalentTo || [])
        .map((id) => String(id))
        .filter(isValidObjectIdString);
    const isContextualCombinedExercise = refDoc?.isExercice === true && equivalentIds.length >= 2;
    if (!isContextualCombinedExercise) {
        return {
            isContextualCombinedExercise: false,
            referenceVariationId: refId,
            mainRootId,
            mainRootName,
            isExerciseByTargetKey,
            variationNameById,
            referenceVariationIds: (referenceVariationIds || []).map((id) => String(id)).filter(Boolean),
            unilateralDetailIds,
        };
    }

    return {
        isContextualCombinedExercise: true,
        referenceVariationId: refId,
        referenceSignature: referenceVariationSignature ? String(referenceVariationSignature) : null,
        equivalentComponentIds: new global.Set(equivalentIds),
        mainRootId,
        mainRootName,
        familyAlternateEquipmentIds: buildFamilyAlternateEquipmentIds(progressionPayload, mainRootId),
        isExerciseByTargetKey,
        variationNameById,
        referenceVariationIds: (referenceVariationIds || []).map((id) => String(id)).filter(Boolean),
        unilateralDetailIds,
    };
}

function familyDetailNameAlreadyContextualized(detailName, mainName) {
    const detailFr = typeof detailName?.fr === 'string' ? detailName.fr.trim() : '';
    const detailEn = typeof detailName?.en === 'string' ? detailName.en.trim() : '';
    const mainFr = typeof mainName?.fr === 'string' ? mainName.fr.trim() : '';
    const mainEn = typeof mainName?.en === 'string' ? mainName.en.trim() : '';
    for (const detail of [detailFr, detailEn]) {
        if (!detail) continue;
        const detailNorm = normalizeFigureName(detail);
        for (const main of [mainFr, mainEn]) {
            if (!main) continue;
            const mainNorm = normalizeFigureName(main);
            if (!mainNorm) continue;
            if (detailNorm === mainNorm) return true;
            if (detailNorm.startsWith(`${mainNorm},`)) return true;
            if (detailNorm.startsWith(`${mainNorm} `)) return true;
        }
    }
    return false;
}

function contextualizeFamilyDetailEntryNames(entries, mergeMeta) {
    const mainName = mergeMeta?.mainRootName;
    const mainRootId = mergeMeta?.mainRootId ? String(mergeMeta.mainRootId) : null;
    const isExerciseByKey = mergeMeta?.isExerciseByTargetKey instanceof Map
        ? mergeMeta.isExerciseByTargetKey
        : new Map();
    if (!mainName?.fr && !mainName?.en) return entries;

    return entries.map((entry) => {
        const key = resolveFigureEntryTargetKey(entry);
        if (!key || key.includes('|')) return entry;
        if (mainRootId && key === mainRootId) return entry;

        const isExercise = entry?.isTargetExercise === true || isExerciseByKey.get(key) === true;
        if (isExercise) return entry;

        const detailName = entry?.name || null;
        if (familyDetailNameAlreadyContextualized(detailName, mainName)) return entry;

        const detailFr = detailName?.fr || detailName?.en || '';
        const detailEn = detailName?.en || detailName?.fr || '';
        if (!detailFr && !detailEn) return entry;

        return {
            ...entry,
            name: {
                fr: mainName?.fr ? `${mainName.fr}, ${detailFr}` : detailFr,
                en: mainName?.en ? `${mainName.en}, ${detailEn}` : detailEn,
            },
        };
    });
}

function toSortedProgressionSignature(ids = []) {
    return [...new global.Set(ids.map((id) => String(id)).filter(Boolean))].sort().join('|');
}

function signatureContainsUnilateralDetail(signature, unilateralDetailIds) {
    if (!signature?.includes('|') || !(unilateralDetailIds instanceof global.Set) || unilateralDetailIds.size === 0) {
        return false;
    }
    return parseProgressionSignatureToObjectIds(signature).some((id) => unilateralDetailIds.has(id));
}

function inferPerformedComboReferenceSignature(
    referenceIds,
    familyScopeDebug,
    isExerciseByKey,
    mainRootId,
    figureEntries = [],
    { lateralMode = 'bilateral', unilateralDetailIds = null } = {},
) {
    const normalizedLateralMode = normalizeLateralMode(lateralMode);
    const uniDetails = unilateralDetailIds instanceof global.Set ? unilateralDetailIds : new global.Set();
    const refs = [...new global.Set((referenceIds || []).map((id) => String(id)).filter(Boolean))];
    if (refs.length === 0) return null;

    const historicalSetsByObjectId = new Map();
    for (const entry of figureEntries || []) {
        const key = resolveFigureEntryTargetKey(entry);
        if (!key || key.includes('|')) continue;
        historicalSetsByObjectId.set(key, getUsedHistoricalSetsFromDetailedPrs(entry?.prs));
    }

    const explicitCombo = refs.length > 1 ? toSortedProgressionSignature(refs) : null;
    const signatures = (familyScopeDebug?.sampleSignatures || [])
        .map((sig) => String(sig))
        .filter((sig) => sig.includes('|'));

    if (explicitCombo && signatures.includes(explicitCombo)) {
        if (normalizedLateralMode === 'bilateral' && signatureContainsUnilateralDetail(explicitCombo, uniDetails)) {
            // Référence multi-composants avec détail unilatéral ignorée en mode bilatéral.
        } else {
            return explicitCombo;
        }
    }

    let bestSignature = null;
    let bestScore = -1;
    for (const signature of signatures) {
        const parts = parseProgressionSignatureToObjectIds(signature);
        if (parts.length < 2) continue;
        if (!refs.every((refId) => parts.includes(refId))) continue;
        if (normalizedLateralMode === 'bilateral' && signatureContainsUnilateralDetail(signature, uniDetails)) {
            continue;
        }
        if ((normalizedLateralMode === 'left' || normalizedLateralMode === 'right')
            && !signatureContainsUnilateralDetail(signature, uniDetails)) {
            continue;
        }

        const exerciseParts = parts.filter((part) => isExerciseByKey.get(part) === true);
        if (exerciseParts.length === 0) continue;

        let score = 1000 - parts.length * 10;
        if (exerciseParts.some((part) => part !== String(mainRootId || ''))) score += 30;
        if (refs.length === 1 && exerciseParts.length === 1) score += 10;
        if (refs.some((refId) => exerciseParts.includes(refId))) score += 50;
        score += exerciseParts.reduce(
            (sum, part) => sum + (historicalSetsByObjectId.get(part) || 0),
            0,
        );
        if (score > bestScore) {
            bestScore = score;
            bestSignature = signature;
        }
    }
    return bestSignature;
}

function entryMatchesFigureAllowlist(entry, allowlist) {
    if (!allowlist) return true;
    const key = resolveFigureEntryTargetKey(entry);
    if (!key) return false;
    if (allowlist.signatures instanceof global.Set && allowlist.signatures.has(key)) return true;
    if (allowlist.variationIds instanceof global.Set && allowlist.variationIds.has(key)) return true;
    return false;
}

function enrichEntriesWithFamilyRowNames(entries, allowlist) {
    if (!allowlist?.familyRows?.length || !Array.isArray(entries)) return entries || [];
    const nameByKey = new Map();
    for (const row of allowlist.familyRows) {
        const name = row?.name || null;
        if (!name) continue;
        const progressionSignature = row.progressionSignature ? String(row.progressionSignature) : null;
        const chartSignature = row.chartSourceVariationSignature
            ? String(row.chartSourceVariationSignature)
            : null;
        const variationId = row.variationId ? String(row.variationId) : null;
        if (progressionSignature) nameByKey.set(progressionSignature, name);
        if (chartSignature) nameByKey.set(chartSignature, name);
        if (variationId && (variationId === progressionSignature || variationId === chartSignature)) {
            nameByKey.set(variationId, name);
        }
    }
    return entries.map((entry) => {
        const key = resolveFigureEntryTargetKey(entry);
        const familyName = nameByKey.get(String(key));
        if (!familyName) return entry;
        return { ...entry, name: familyName };
    });
}

function filterEntriesByFigureAllowlist(entries, allowlist) {
    if (!allowlist || !Array.isArray(entries)) return entries || [];
    return entries.filter((entry) => entryMatchesFigureAllowlist(entry, allowlist));
}

function shouldSkipFigureExtrapolation(entry, allowlist) {
    const usedHistoricalSets = getUsedHistoricalSetsFromDetailedPrs(entry?.prs);
    if (usedHistoricalSets > 0) return false;
    const key = resolveFigureEntryTargetKey(entry);
    if (allowlist?.edgeVariationIds instanceof global.Set && allowlist.edgeVariationIds.has(String(key))) {
        return false;
    }
    return true;
}

function buildComboDisplayNameFromSignature(signature, nameById, isExerciseByKey) {
    const parts = parseProgressionSignatureToObjectIds(signature);
    const exerciseLabels = [];
    const detailLabels = [];
    const seenFr = new global.Set();
    for (const part of parts) {
        const label = nameById.get(part);
        if (!label?.fr && !label?.en) continue;
        const frKey = normalizeFigureName(label.fr || label.en || '');
        if (frKey && seenFr.has(frKey)) continue;
        if (frKey) seenFr.add(frKey);
        if (isExerciseByKey.get(part) === true) {
            exerciseLabels.push(label);
        } else {
            detailLabels.push(label);
        }
    }
    const ordered = [...exerciseLabels, ...detailLabels];
    const fr = ordered.map((label) => label.fr || label.en).filter(Boolean).join(', ');
    const en = ordered.map((label) => label.en || label.fr).filter(Boolean).join(', ');
    return fr || en ? { fr: fr || en, en: en || fr } : null;
}

/** Libellé aligné sur la sélection utilisateur (feuilles workout), pas la décomposition equivalentTo. */
function buildReferenceSelectionDisplayName(referenceVariationIds = [], nameById, isExerciseByKey) {
    const ids = [...new global.Set((referenceVariationIds || []).map((id) => String(id)).filter(Boolean))];
    if (!ids.length) return null;
    const exerciseLabels = [];
    const detailLabels = [];
    const seenFr = new global.Set();
    for (const id of ids) {
        const label = nameById.get(id);
        if (!label?.fr && !label?.en) continue;
        const frKey = normalizeFigureName(label.fr || label.en || '');
        if (frKey && seenFr.has(frKey)) continue;
        if (frKey) seenFr.add(frKey);
        if (isExerciseByKey.get(id) === true) exerciseLabels.push(label);
        else detailLabels.push(label);
    }
    const ordered = [...exerciseLabels, ...detailLabels];
    if (!ordered.length) return null;
    const fr = ordered.map((label) => label.fr || label.en).filter(Boolean).join(', ');
    const en = ordered.map((label) => label.en || label.fr).filter(Boolean).join(', ');
    return fr || en ? { fr: fr || en, en: en || fr } : null;
}

function ensureComboSignatureEntry(mergedByKey, comboSignature, contextualMergeMeta) {
    if (!comboSignature?.includes('|') || mergedByKey.has(comboSignature)) return;

    const parts = parseProgressionSignatureToObjectIds(comboSignature);
    const isExerciseByKey = contextualMergeMeta?.isExerciseByTargetKey || new Map();
    const nameById = new Map();
    for (const part of parts) {
        const component = mergedByKey.get(part);
        if (component?.name) nameById.set(part, component.name);
    }
    const exercisePart = parts.find((part) => isExerciseByKey.get(part) === true) || parts[0];
    const primary = mergedByKey.get(exercisePart);
    if (!primary) return;

    mergedByKey.set(comboSignature, {
        ...primary,
        variationId: comboSignature,
        variationSignature: comboSignature,
        isDirect: true,
        name: buildComboDisplayNameFromSignature(comboSignature, nameById, isExerciseByKey) || primary.name,
        prs: primary.prs,
    });
}

function enrichDirectComboEntryNames(entries, effectiveReferenceSignature, contextualMergeMeta) {
    if (!effectiveReferenceSignature) return entries;

    const isExerciseByKey = contextualMergeMeta?.isExerciseByTargetKey || new Map();
    const variationNameById = contextualMergeMeta?.variationNameById || new Map();
    const referenceVariationIds = contextualMergeMeta?.referenceVariationIds || [];
    const nameById = new Map();
    for (const entry of entries) {
        const key = resolveFigureEntryTargetKey(entry);
        if (!key || !entry?.name || key.includes('|')) continue;
        nameById.set(key, entry.name);
    }
    for (const [id, name] of variationNameById) {
        if (name && !nameById.has(id)) nameById.set(id, name);
    }

    const selectionDisplayName = buildReferenceSelectionDisplayName(
        referenceVariationIds,
        nameById,
        isExerciseByKey,
    );

    return entries.map((entry) => {
        const key = resolveFigureEntryTargetKey(entry);
        if (key !== effectiveReferenceSignature) return entry;
        const comboName = selectionDisplayName
            || (effectiveReferenceSignature.includes('|')
                ? buildComboDisplayNameFromSignature(key, nameById, isExerciseByKey)
                : null);
        if (!comboName) return { ...entry, isDirect: true };
        return {
            ...entry,
            isDirect: true,
            name: comboName,
        };
    });
}

function contextualizeFamilyEquipmentEntryNames(entries, contextualMergeMeta) {
    return contextualizeFamilyDetailEntryNames(entries, contextualMergeMeta);
}

function mergeFigureAndProgressionDetailedEntries(figurePayload, progressionPayload, {
    multiReferenceSelection = false,
    contextualMergeMeta = null,
    effectiveReferenceSignature = null,
} = {}) {
    const mergedByKey = new Map();
    const figureEntries = Array.isArray(figurePayload?.entries) ? figurePayload.entries : [];
    const progressionEntries = Array.isArray(progressionPayload?.entries) ? progressionPayload.entries : [];

    for (const entry of figureEntries) {
        const key = resolveFigureEntryTargetKey(entry);
        if (!key) continue;
        mergedByKey.set(key, {
            ...entry,
            variationSignature: entry.variationSignature || null,
        });
    }

    const skippedProgressionEntries = [];
    for (const entry of progressionEntries) {
        const key = resolveFigureEntryTargetKey(entry);
        if (!key) continue;
        const entryToStore = entry;
        const storageKey = key;
        const existing = mergedByKey.get(storageKey);
        if (existing) {
            const mergedCandidate = {
                ...existing,
                ...entryToStore,
                prs: entryToStore?.prs ?? existing.prs,
                name: entryToStore?.name ?? existing.name,
                isDirect: entryToStore?.isDirect === true || existing?.isDirect === true,
            };
            const winner = pickPreferredDuplicateFigureEntry(existing, mergedCandidate);
            if (key !== storageKey) {
                logFigureEntryPipelineStage('merge-key-collision', {
                    incomingKey: key,
                    storageKey,
                    aliasKey: null,
                    incoming: summarizeEntryPrsPeakForDebug(entryToStore),
                    existing: summarizeEntryPrsPeakForDebug(existing),
                    mergedCandidate: summarizeEntryPrsPeakForDebug(mergedCandidate),
                    winner: summarizeEntryPrsPeakForDebug(winner),
                    prsSource: entryToStore?.prs === mergedCandidate.prs
                        ? (entryToStore?.prs ? 'incoming' : 'existing')
                        : 'mixed',
                });
            }
            mergedByKey.set(storageKey, winner);
            continue;
        }
        mergedByKey.set(storageKey, entryToStore);
    }

    const referenceVariationSignature = effectiveReferenceSignature
        || progressionPayload?.referenceVariationSignature
        || null;
    ensureComboSignatureEntry(mergedByKey, referenceVariationSignature, contextualMergeMeta);

    const referenceVariationId = progressionPayload?.referenceVariationId
        || figurePayload?.referenceVariationId
        || null;
    const mergedEntries = [...mergedByKey.values()];
    let filteredEntries = mergedEntries;
    const beforeTargetKeyDedupe = [...filteredEntries];
    filteredEntries = contextualizeFamilyDetailEntryNames(filteredEntries, contextualMergeMeta);
    filteredEntries = enrichDirectComboEntryNames(
        filteredEntries,
        referenceVariationSignature,
        contextualMergeMeta,
    );
    filteredEntries = dedupeEntriesByTargetKey(filteredEntries);
    const dedupeByTargetKeyDropped = beforeTargetKeyDedupe
        .filter((entry) => !filteredEntries.some(
            (kept) => resolveFigureEntryTargetKey(kept) === resolveFigureEntryTargetKey(entry),
        ))
        .map((entry) => ({
            ...summarizeFigureEntryForDebug(entry),
            reason: 'dedupe_by_target_key',
        }));
    logFigureEntryPipelineStage('merge', {
        figureEntryCount: figureEntries.length,
        progressionEntryCount: progressionEntries.length,
        skippedProgressionEntries,
        multiReferenceSelection,
        referenceVariationSignature: referenceVariationSignature || null,
        referenceVariationId: referenceVariationId || null,
        mergedKeys: mergedEntries.map((entry) => resolveFigureEntryTargetKey(entry)),
        mergedEntrySummaries: mergedEntries.map((entry) => summarizeEntryPrsPeakForDebug(entry)),
        dedupeByTargetKeyDropped,
        finalMergedKeys: filteredEntries.map((entry) => resolveFigureEntryTargetKey(entry)),
        finalEntrySummaries: filteredEntries.map((entry) => summarizeEntryPrsPeakForDebug(entry)),
    });
    const entries = filteredEntries.sort((a, b) => {
        const aKey = resolveFigureEntryTargetKey(a);
        const bKey = resolveFigureEntryTargetKey(b);
        if (referenceVariationId) {
            const ref = String(referenceVariationId);
            if (aKey === ref && bKey !== ref) return -1;
            if (bKey === ref && aKey !== ref) return 1;
        }
        if (referenceVariationSignature) {
            const refSig = String(referenceVariationSignature);
            if (aKey === refSig && bKey !== refSig) return -1;
            if (bKey === refSig && aKey !== refSig) return 1;
        }
        if (a?.isDirect === true && b?.isDirect !== true) return -1;
        if (b?.isDirect === true && a?.isDirect !== true) return 1;
        const aName = a?.name?.fr || a?.name?.en || '';
        const bName = b?.name?.fr || b?.name?.en || '';
        return aName.localeCompare(bName);
    });

    return {
        mainExerciseId: figurePayload?.mainExerciseId || progressionPayload?.mainExerciseId,
        progressionGraphContextVariationId: figurePayload?.progressionGraphContextVariationId
            || progressionPayload?.progressionGraphContextVariationId,
        referenceVariationId,
        referenceVariationSignature,
        entries,
        meta: {
            ...(figurePayload?.meta || {}),
            ...(progressionPayload?.meta || {}),
            figureTargetCount: figureEntries.length,
            progressionTargetCount: progressionEntries.length,
            mergedTargetCount: entries.length,
        },
    };
}

async function getFigureDetailedEntries({
    userId,
    mainExerciseId,
    referenceVariations,
    includeAllGraphTargets = false,
    expandGenericTargets = true,
    maxTargets = 40,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    lateralMode = 'bilateral',
    familyKey = null,
}) {
    const commonParams = {
        userId,
        exercice,
        categories,
        dateMin,
        unilateralSide,
        referenceVariations,
        mainExerciseId,
        includeAllGraphTargets: Boolean(includeAllGraphTargets),
        expandGenericTargets: expandGenericTargets !== false,
        maxTargets,
        lateralMode,
        familyKey,
    };
    const [progressionPayload, figurePayload] = await Promise.all([
        setLib.getProgressionDetailedPRs({
            ...commonParams,
            lateralMode,
        }),
        setLib.getFigureDetailedPRs(commonParams),
    ]);
    const referenceList = Array.isArray(referenceVariations)
        ? referenceVariations
        : (referenceVariations != null ? [referenceVariations] : []);
    const contextualMergeMeta = await buildContextualReferenceExerciseMergeMeta({
        referenceVariationId: progressionPayload.referenceVariationId || figurePayload.referenceVariationId,
        normalizedMainExerciseId: figurePayload.mainExerciseId || progressionPayload.mainExerciseId,
        referenceVariationSignature: progressionPayload.referenceVariationSignature,
        progressionPayload,
        figurePayload,
        referenceVariationIds: referenceList,
    });
    const inferredComboSignature = inferPerformedComboReferenceSignature(
        referenceList,
        progressionPayload?.meta?.familyScopeDebug,
        contextualMergeMeta.isExerciseByTargetKey,
        contextualMergeMeta.mainRootId,
        figurePayload?.entries,
        {
            lateralMode,
            unilateralDetailIds: contextualMergeMeta.unilateralDetailIds,
        },
    );
    const explicitMultiReference = referenceList.length > 1;
    const effectiveReferenceSignature = inferredComboSignature?.includes('|')
        ? inferredComboSignature
        : (progressionPayload.referenceVariationSignature || null);
    const multiReferenceSelection = explicitMultiReference || Boolean(inferredComboSignature?.includes('|'));

    const figureEntryKeys = (figurePayload?.entries || []).map((entry) => resolveFigureEntryTargetKey(entry));
    const progressionEntryKeys = (progressionPayload?.entries || []).map((entry) => resolveFigureEntryTargetKey(entry));
    const figureKeySet = new Set(figureEntryKeys);
    const progressionKeySet = new Set(progressionEntryKeys);
    const familyRowSummaries = (figurePayload?.allowlist?.familyRows || []).map((row) => ({
        name: row?.name?.fr || row?.name?.en || null,
        variationId: row?.variationId || null,
        progressionSignature: row?.progressionSignature || null,
        chartSourceVariationSignature: row?.chartSourceVariationSignature || null,
        count: row?.count ?? null,
    }));
    const familySignaturesMissingFromDetailed = familyRowSummaries.filter((row) => {
        const progressionSig = row?.progressionSignature ? String(row.progressionSignature) : null;
        if (!progressionSig) return false;
        return !figureKeySet.has(progressionSig) && !progressionKeySet.has(progressionSig);
    });

    logFigureEntryPipelineStage('pre-merge', {
        explicitMultiReference,
        multiReferenceSelection,
        effectiveReferenceSignature,
        inferredComboSignature: inferredComboSignature || null,
        referenceList,
        figureEntryKeys,
        progressionEntryKeys,
        familyRowSummaries,
        familySignaturesMissingFromDetailed,
    });

    if (isSmithBenchGuidedFigureDebugFocus({
        referenceList,
        referenceVariationId: progressionPayload.referenceVariationId || figurePayload.referenceVariationId,
    })) {
        logFigureEntryPipelineStage('pre-merge:smith-bench-context', {
            contextualMergeMeta: {
                isContextualCombinedExercise: contextualMergeMeta?.isContextualCombinedExercise === true,
                referenceVariationId: contextualMergeMeta?.referenceVariationId || null,
                referenceSignature: contextualMergeMeta?.referenceSignature || null,
                mainRootId: contextualMergeMeta?.mainRootId || null,
                equivalentComponentIds: contextualMergeMeta?.equivalentComponentIds
                    ? [...contextualMergeMeta.equivalentComponentIds]
                    : [],
            },
            progressionReferenceVariationSignature: progressionPayload?.referenceVariationSignature || null,
            familySignaturesMissingFromDetailed,
            note: 'Référence solo 6922144c → signature combo via equivalentTo; entrées conservées par clé technique (signature/id).',
        });
    }

    const mergedPayload = mergeFigureAndProgressionDetailedEntries(figurePayload, progressionPayload, {
        multiReferenceSelection,
        contextualMergeMeta,
        effectiveReferenceSignature,
    });
    const allowlist = figurePayload?.allowlist || null;
    const beforeAllowlistFilter = [...(mergedPayload.entries || [])];
    mergedPayload.entries = filterEntriesByFigureAllowlist(mergedPayload.entries, allowlist);
    const allowlistKeptKeys = new Set(
        mergedPayload.entries.map((entry) => resolveFigureEntryTargetKey(entry)),
    );
    const allowlistDropped = beforeAllowlistFilter
        .filter((entry) => !allowlistKeptKeys.has(resolveFigureEntryTargetKey(entry)))
        .map((entry) => ({
            ...summarizeFigureEntryForDebug(entry),
            reason: 'allowlist_mismatch',
            allowlistSignatures: allowlist?.signatures instanceof global.Set
                ? [...allowlist.signatures]
                : [],
            allowlistVariationIds: allowlist?.variationIds instanceof global.Set
                ? [...allowlist.variationIds]
                : [],
        }));
    logFigureEntryPipelineStage('post-allowlist', {
        beforeAllowlistCount: beforeAllowlistFilter.length,
        afterAllowlistCount: mergedPayload.entries.length,
        allowlistDropped,
        finalEntrySummaries: mergedPayload.entries.map((entry) => summarizeFigureEntryForDebug(entry)),
    });
    mergedPayload.entries = enrichEntriesWithFamilyRowNames(mergedPayload.entries, allowlist);
    mergedPayload.meta = {
        ...(mergedPayload.meta || {}),
        allowlist,
        familyScopeDebug: allowlist?.familyScopeDebug || mergedPayload.meta?.familyScopeDebug || null,
        allowlistFamilyRowCount: allowlist?.familyRows?.length ?? 0,
        allowlistEdgeCount: allowlist?.edgeVariationIds?.size ?? 0,
    };
    return mergedPayload;
}

async function computeRecommendedWeightFigure({
    userId,
    mainExerciseId,
    referenceVariations,
    targetUnit,
    targetValue,
    includeAllGraphTargets = false,
    expandGenericTargets = true,
    maxTargets = 40,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    lateralMode = 'bilateral',
    familyKey = null,
    sessionSets = null,
    isUnilateral = undefined,
}) {
    if (targetUnit !== 'repetitions' && targetUnit !== 'seconds') {
        return { success: false, reason: 'INVALID_INPUT', message: 'Unité cible invalide / Invalid target unit.' };
    }
    const includeAll = Boolean(includeAllGraphTargets);
    const normalizedMainExerciseId = await resolveMainExerciseIdForProgression(mainExerciseId);
    console.debug('[whichfigure] computeRecommendedWeightFigure:start', {
        userId: String(userId || ''),
        mainExerciseId: String(mainExerciseId || ''),
        referenceVariations: Array.isArray(referenceVariations) ? referenceVariations : [referenceVariations],
        targetUnit,
        targetValue,
        includeAllGraphTargets: includeAll,
        expandGenericTargets: expandGenericTargets === true,
        familyKey: familyKey || null,
        lateralMode,
        sessionSetsCount: Array.isArray(sessionSets) ? sessionSets.length : 0,
    });
    const payload = await getFigureDetailedEntries({
        userId,
        mainExerciseId,
        referenceVariations,
        includeAllGraphTargets: includeAll,
        expandGenericTargets,
        maxTargets,
        exercice,
        categories,
        dateMin,
        unilateralSide,
        lateralMode,
        familyKey,
    });
    const allowlist = payload?.meta?.allowlist || null;
    const {
        graphVariationIdByTargetKey,
        progressionGraphContextVariationId,
        bodyweightPolicyById,
        adjacency,
        difficultyScoreByTarget,
        progressionScopeByTarget,
    } = await prepareSignatureAwareFigureContext(payload, normalizedMainExerciseId);
    console.debug('[whichfigure] computeRecommendedWeightFigure:entries', {
        entriesCount: payload.entries?.length ?? 0,
        sampleTargetKeys: payload.entries.slice(0, 5).map((e) => resolveFigureEntryTargetKey(e)),
        referenceVariationId: payload.referenceVariationId,
    });
    const userMeasures = await UserMeasure.find({ userId }, { measuredAt: 1, 'weight.kg': 1 }).sort({ measuredAt: 1 }).lean();
    const userWeightKg = resolveUserWeightKgForDate(userMeasures, new Date());
    const { anchorPeak, anchorVariationId } = pickAnchorPeakFromEntries(payload.entries);
    const anchorCandidates = getAnchorCandidatesFromEntries(payload.entries);
    const recommendations = await Promise.all(payload.entries.map(async (entry) => {
        const targetKey = resolveFigureEntryTargetKey(entry);
        const targetGraphVariationId = graphVariationIdByTargetKey.get(targetKey) || targetKey;
        const progressionScopeMeta = progressionScopeByTarget.get(targetKey)
            || progressionScopeByTarget.get(String(targetGraphVariationId))
            || {
                progressionScope: 'exercise',
                isGenericProgressionTarget: false,
            };
        const graphDifficultyScore = await resolveGraphDifficultyScoreForFigureEntry(entry, {
            difficultyScoreByTarget,
            referenceVariationId: payload.referenceVariationId,
            contextVariationId: progressionGraphContextVariationId,
            adjacency,
            graphVariationIdByTargetKey,
        });
        const usedHistoricalSets = getUsedHistoricalSetsFromDetailedPrs(entry?.prs);
        const usedSets = {
            fetchedHistoricalSets: usedHistoricalSets,
            usedHistoricalSets,
            usedSessionSets: 0,
            usedTotalSets: usedHistoricalSets,
            maxSetsRequested: null
        };
        let peak = collectBestPeakFromDetailedPrs(entry?.prs);
        const skipExtrapolation = shouldSkipFigureExtrapolation(entry, allowlist);
        if ((!peak || !Number.isFinite(Number(peak.normalizedOneRm))) && !skipExtrapolation && anchorCandidates.length > 0) {
            for (const candidate of anchorCandidates) {
                const candidateKey = String(candidate.variationId);
                peak = await extrapolatePeakFromAnchor({
                    anchorPeak: candidate.peak,
                    anchorVariationId: graphVariationIdByTargetKey.get(candidateKey) || candidateKey,
                    targetVariationId: String(targetGraphVariationId),
                    contextVariationId: progressionGraphContextVariationId,
                    adjacency
                });
                if (peak && Number.isFinite(Number(peak.normalizedOneRm))) {
                    break;
                }
            }
        }
        if (entry.isDirect === true && Array.isArray(sessionSets) && sessionSets.length > 0) {
            const augmented = await augmentDirectEntryPeakWithSessionSets({
                peak,
                userId,
                referenceVariations,
                sessionSets,
                isUnilateral,
                unilateralSide,
            });
            peak = augmented.peak;
            usedSets.usedSessionSets = augmented.usedSessionSets;
            usedSets.usedTotalSets = usedHistoricalSets + augmented.usedSessionSets;
        }
        if (!peak || !Number.isFinite(Number(peak.normalizedOneRm))) {
            return {
                variationId: targetKey,
                variationSignature: entry.variationSignature || targetKey,
                isDirect: entry.isDirect === true,
                name: entry.name || null,
                progressionScope: progressionScopeMeta.progressionScope,
                isGenericProgressionTarget: progressionScopeMeta.isGenericProgressionTarget === true,
                success: false,
                reason: 'NO_DATA',
                message: 'Incalculable',
                targetUnit,
                targetValue: Number(targetValue),
                difficultyScore: Number.isFinite(Number(graphDifficultyScore))
                    ? Number(graphDifficultyScore)
                    : getRecommendationDifficultyScore({ isDirect: entry.isDirect === true, strengthPeak: null }),
                usedSets,
                strengthPeak: null
            };
        }
        const targetPolicy = resolveBodyweightPolicyForFigureEntry(
            entry,
            bodyweightPolicyById,
            targetGraphVariationId
        );
        const sourceVariationId = peak?.sourceVariationId ? String(peak.sourceVariationId) : null;
        const difficultyRatioUsed = Number(peak?.difficultyRatioUsed);
        const shouldUseSourcePolicy = Boolean(
            sourceVariationId
            && sourceVariationId !== String(targetGraphVariationId)
            && Number.isFinite(difficultyRatioUsed)
            && Math.abs(difficultyRatioUsed - 1) < 1e-9
            && bodyweightPolicyById.has(sourceVariationId)
        );
        const policy = shouldUseSourcePolicy
            ? bodyweightPolicyById.get(sourceVariationId)
            : targetPolicy;
        const weightedBodyweightKg = policy.includeBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * Number(policy.exerciseBodyWeightRatio || 1)
            : 0;
        const includeBodyweight = policy.includeBodyweight === true && weightedBodyweightKg > 0;
        const peakSlot = resolvePeakPrSlotFromEntry(entry, peak);
        const oneRmForRecommendation = resolveOneRmForFigureRecommendation({
            peak,
            peakSlot,
            includeBodyweight,
            weightedBodyweightKg,
            externalEffectiveLoadKg: Number.isFinite(Number(peak?.weightLoad)) ? Number(peak.weightLoad) : 0,
        });
        const recommendation = computeTargetLoadFromOneRm(
            oneRmForRecommendation,
            targetUnit,
            targetValue,
            weightedBodyweightKg
        );
        const loadKg = recommendation.success ? Number(recommendation.loadKg) : null;
        const isReferenceEntry = String(targetKey) === String(payload.referenceVariationId)
            || entry?.isDirect === true;
        if (isReferenceEntry) {
            logWhichweightFigureLoadFormulaDiagnostics({
                targetKey,
                targetGraphVariationId: String(targetGraphVariationId),
                name: entry?.name?.fr || entry?.name?.en || null,
                isDirect: entry?.isDirect === true,
                targetUnit,
                targetValue: Number(targetValue),
                peakRmKey: peak?.rmKey ?? null,
                peakSetId: peak?.setId ?? null,
                peakRawReps: peak?.value ?? null,
                peakWeightLoadExternal: peak?.weightLoad ?? null,
                peakNormalizedOneRmChargeUtile: peak?.normalizedOneRm ?? null,
                peakNormalizedOneRmForRecommendation: peak?.normalizedOneRmForRecommendation ?? null,
                peakDifficultyRatioUsed: peak?.difficultyRatioUsed ?? null,
                peakExtrapolated: peak?.extrapolated === true,
                oneRmUsedForInverse: oneRmForRecommendation,
                bodyweight: {
                    includeBodyweight: policy.includeBodyweight === true,
                    userWeightKg: Number.isFinite(Number(userWeightKg)) ? Number(userWeightKg) : null,
                    exerciseBodyWeightRatio: Number(policy.exerciseBodyWeightRatio || 1),
                    weightedBodyweightKg: toRounded(weightedBodyweightKg, 2),
                },
                usedSets,
                inverseBreakdown: buildFigureTargetLoadInverseBreakdown(
                    oneRmForRecommendation,
                    targetUnit,
                    targetValue,
                    weightedBodyweightKg,
                ),
                recommendedLoadKg: loadKg,
                recommendedEffectiveWeightLoadKg: recommendation.success
                    ? toRounded(loadKg + weightedBodyweightKg, 2)
                    : null,
                recommendationSuccess: recommendation.success === true,
                recommendationReason: recommendation.reason ?? null,
            });
        }
        return {
            variationId: targetKey,
            variationSignature: entry.variationSignature || targetKey,
            isDirect: entry.isDirect === true,
            name: entry.name || null,
            progressionScope: progressionScopeMeta.progressionScope,
            isGenericProgressionTarget: progressionScopeMeta.isGenericProgressionTarget === true,
            difficultyScore: Number.isFinite(Number(graphDifficultyScore))
                ? Number(graphDifficultyScore)
                : getRecommendationDifficultyScore({ isDirect: entry.isDirect === true, strengthPeak: peak }),
            success: recommendation.success === true,
            reason: recommendation.reason || null,
            message: recommendation.message || null,
            targetUnit,
            targetValue: Number(targetValue),
            recommendedLoadKg: recommendation.success ? loadKg : null,
            recommendedEffectiveWeightLoadKg: recommendation.success ? toRounded(loadKg + weightedBodyweightKg, 2) : null,
            recommendedLoadLbs: recommendation.success ? kgToLbsOrNull(loadKg) : null,
            recommendedTotalLoadKg: recommendation.success ? toRounded(loadKg + weightedBodyweightKg, 2) : null,
            bodyweight: {
                includeBodyweight: policy.includeBodyweight === true,
                userWeightKg: Number.isFinite(Number(userWeightKg)) ? Number(userWeightKg) : null,
                exerciseBodyWeightRatio: Number(policy.exerciseBodyWeightRatio || 1),
                weightedBodyweightKg: toRounded(weightedBodyweightKg, 2)
            },
            usedSets,
            strengthPeak: peak
        };
    }));
    const recommendationsWithImplicitFull = buildImplicitFullFallbackRecommendations(recommendations);
    const recommendationsDeduped = dedupeFigureRecommendationsByTargetKey(recommendationsWithImplicitFull);
    logFigureRecommendationsDedupeDiff('whichweight', recommendationsWithImplicitFull, recommendationsDeduped);
    if (Array.isArray(sessionSets) && sessionSets.length > 0) {
        const directRec = recommendationsDeduped.find((entry) => entry?.isDirect === true);
        console.debug('[whichfigure] computeRecommendedWeightFigure:sessionSets', {
            sessionSetsCount: sessionSets.length,
            payloadEntriesCount: payload.entries?.length ?? 0,
            directRecommendation: directRec
                ? {
                    success: directRec.success === true,
                    recommendedLoadKg: directRec.recommendedLoadKg ?? null,
                    usedHistoricalSets: directRec.usedSets?.usedHistoricalSets ?? null,
                    usedSessionSets: directRec.usedSets?.usedSessionSets ?? null,
                    reason: directRec.reason ?? null,
                }
                : null,
        });
    }
    return {
        success: true,
        referenceVariationId: String(payload.referenceVariationId),
        mainExerciseId: String(payload.mainExerciseId),
        targetUnit,
        targetValue: Number(targetValue),
        recommendations: sortRecommendationsByRecommendedLoadDescending(recommendationsDeduped),
        meta: {
            ...payload.meta,
            includeAllGraphTargetsRequested: Boolean(includeAllGraphTargets),
            includeAllGraphTargetsApplied: includeAll,
            includeAllGraphTargets: includeAll,
            expandGenericTargets: expandGenericTargets === true
        }
    };
}

async function computeRecommendedValueFigure({
    userId,
    mainExerciseId,
    referenceVariations,
    targetUnit,
    effectiveWeightLoad,
    includeAllGraphTargets = false,
    expandGenericTargets = true,
    maxTargets = 40,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined,
    lateralMode = 'bilateral',
    familyKey = null,
    sessionSets = null,
    isUnilateral = undefined,
}) {
    if (targetUnit !== 'repetitions' && targetUnit !== 'seconds') {
        return { success: false, reason: 'INVALID_INPUT', message: 'Unité cible invalide / Invalid target unit.' };
    }
    const includeAll = Boolean(includeAllGraphTargets);
    const normalizedMainExerciseId = await resolveMainExerciseIdForProgression(mainExerciseId);
    const payload = await getFigureDetailedEntries({
        userId,
        mainExerciseId,
        referenceVariations,
        includeAllGraphTargets: includeAll,
        expandGenericTargets,
        maxTargets,
        exercice,
        categories,
        dateMin,
        unilateralSide,
        lateralMode,
        familyKey,
    });
    const allowlist = payload?.meta?.allowlist || null;
    const {
        graphVariationIdByTargetKey,
        progressionGraphContextVariationId,
        bodyweightPolicyById,
        adjacency,
        difficultyScoreByTarget,
        progressionScopeByTarget,
    } = await prepareSignatureAwareFigureContext(payload, normalizedMainExerciseId);
    const userMeasures = await UserMeasure.find({ userId }, { measuredAt: 1, 'weight.kg': 1 }).sort({ measuredAt: 1 }).lean();
    const userWeightKg = resolveUserWeightKgForDate(userMeasures, new Date());
    const { anchorPeak, anchorVariationId } = pickAnchorPeakFromEntries(payload.entries);
    const anchorCandidates = getAnchorCandidatesFromEntries(payload.entries);
    const referenceList = Array.isArray(referenceVariations)
        ? referenceVariations
        : (referenceVariations != null ? [referenceVariations] : []);
    if (isFrontLeverFigureDebugFocus({
        referenceList,
        referenceVariationId: payload.referenceVariationId,
        mainExerciseId,
    })) {
        logFigureEntryPipelineStage('whichvalue:front-lever-context', {
            includeAllGraphTargets: includeAll,
            expandGenericTargets: expandGenericTargets !== false,
            expandGenericTargetsConsumedByBackend: true,
            graphTargetMode: payload?.meta?.allowlist?.familyScopeDebug?.graphTargetMode
                || payload?.meta?.familyScopeDebug?.graphTargetMode
                || null,
            allowlistEdgeCount: payload?.meta?.allowlistEdgeCount ?? null,
            allowlistFamilyRowCount: payload?.meta?.allowlistFamilyRowCount ?? null,
            mergedTargetCount: payload?.meta?.mergedTargetCount ?? payload.entries?.length ?? null,
            progressionScopeByTarget: [...(progressionScopeByTarget?.entries?.() || [])].map(([key, meta]) => ({
                key,
                progressionScope: meta?.progressionScope ?? null,
                isGenericProgressionTarget: meta?.isGenericProgressionTarget === true,
            })),
            entryKeys: (payload.entries || []).map((entry) => ({
                key: resolveFigureEntryTargetKey(entry),
                name: entry?.name?.fr || entry?.name?.en || null,
                isEdgeTarget: entry?.isEdgeTarget === true,
                sets: getUsedHistoricalSetsFromDetailedPrs(entry?.prs),
            })),
            note: 'Graphe complet via resolveFigureGraphTargetVariationIds quand expandGenericTargets !== false.',
        });
    }
    logFigureEntryPipelineStage('whichvalue:inputs', {
        effectiveWeightLoad: Number(effectiveWeightLoad),
        targetUnit,
        referenceVariationId: payload.referenceVariationId,
        anchorVariationId,
        anchorPeakOneRm: anchorPeak?.normalizedOneRm ?? null,
        entrySummaries: (payload.entries || []).map((entry) => summarizeEntryPrsPeakForDebug(entry)),
    });

    const recommendations = await Promise.all(payload.entries.map(async (entry) => {
        const targetKey = resolveFigureEntryTargetKey(entry);
        const targetGraphVariationId = graphVariationIdByTargetKey.get(targetKey) || targetKey;
        const progressionScopeMeta = progressionScopeByTarget.get(targetKey)
            || progressionScopeByTarget.get(String(targetGraphVariationId))
            || {
                progressionScope: 'exercise',
                isGenericProgressionTarget: false,
            };
        const graphDifficultyScore = await resolveGraphDifficultyScoreForFigureEntry(entry, {
            difficultyScoreByTarget,
            referenceVariationId: payload.referenceVariationId,
            contextVariationId: progressionGraphContextVariationId,
            adjacency,
            graphVariationIdByTargetKey,
        });
        const usedHistoricalSets = getUsedHistoricalSetsFromDetailedPrs(entry?.prs);
        const usedSets = {
            fetchedHistoricalSets: usedHistoricalSets,
            usedHistoricalSets,
            usedSessionSets: 0,
            usedTotalSets: usedHistoricalSets,
            maxSetsRequested: null
        };
        let peak = collectBestPeakFromDetailedPrs(entry?.prs);
        const peakFromEntryPrs = peak ? { ...peak } : null;
        const skipExtrapolation = shouldSkipFigureExtrapolation(entry, allowlist);
        let peakSource = peak ? 'entry_prs' : null;
        let extrapolationAnchorKey = null;
        if ((!peak || !Number.isFinite(Number(peak.normalizedOneRm))) && !skipExtrapolation && anchorCandidates.length > 0) {
            for (const candidate of anchorCandidates) {
                const candidateKey = String(candidate.variationId);
                peak = await extrapolatePeakFromAnchor({
                    anchorPeak: candidate.peak,
                    anchorVariationId: graphVariationIdByTargetKey.get(candidateKey) || candidateKey,
                    targetVariationId: String(targetGraphVariationId),
                    contextVariationId: progressionGraphContextVariationId,
                    adjacency
                });
                if (peak && Number.isFinite(Number(peak.normalizedOneRm))) {
                    peakSource = 'anchor_extrapolation';
                    extrapolationAnchorKey = candidateKey;
                    break;
                }
            }
        }
        if (entry.isDirect === true && Array.isArray(sessionSets) && sessionSets.length > 0) {
            const augmented = await augmentDirectEntryPeakWithSessionSets({
                peak,
                userId,
                referenceVariations,
                sessionSets,
                isUnilateral,
                unilateralSide,
            });
            peak = augmented.peak;
            usedSets.usedSessionSets = augmented.usedSessionSets;
            usedSets.usedTotalSets = usedHistoricalSets + augmented.usedSessionSets;
            if (augmented.usedSessionSets > 0 && peak?.rmKey === 'SESSION') {
                peakSource = 'session_sets';
            }
        }
        if (!peak || !Number.isFinite(Number(peak.normalizedOneRm))) {
            const failedResult = {
                variationId: targetKey,
                variationSignature: entry.variationSignature || targetKey,
                isDirect: entry.isDirect === true,
                name: entry.name || null,
                progressionScope: progressionScopeMeta.progressionScope,
                isGenericProgressionTarget: progressionScopeMeta.isGenericProgressionTarget === true,
                success: false,
                reason: 'NO_DATA',
                message: 'Incalculable',
                targetUnit,
                effectiveWeightLoad: Number(effectiveWeightLoad),
                difficultyScore: Number.isFinite(Number(graphDifficultyScore))
                    ? Number(graphDifficultyScore)
                    : getRecommendationDifficultyScore({ isDirect: entry.isDirect === true, strengthPeak: null }),
                usedSets,
                strengthPeak: null
            };
            if (isFrontLeverFigureDebugFocus({
                referenceList,
                referenceVariationId: payload.referenceVariationId,
                mainExerciseId,
                targetKey,
                name: entry?.name?.fr || entry?.name?.en || null,
            })) {
                logFigureEntryPipelineStage('whichvalue:front-lever-compute', {
                    targetKey,
                    targetGraphVariationId: String(targetGraphVariationId),
                    name: entry?.name?.fr || entry?.name?.en || null,
                    isEdgeTarget: entry?.isEdgeTarget === true,
                    progressionScope: progressionScopeMeta.progressionScope,
                    isGenericProgressionTarget: progressionScopeMeta.isGenericProgressionTarget === true,
                    usedHistoricalSets,
                    skipExtrapolation,
                    peakSource,
                    extrapolationAnchorKey,
                    graphDifficultyScore: Number.isFinite(Number(graphDifficultyScore)) ? Number(graphDifficultyScore) : null,
                    recommendedValue: null,
                    success: false,
                    reason: failedResult.reason,
                });
            }
            return failedResult;
        }
        const policy = resolveBodyweightPolicyForFigureEntry(
            entry,
            bodyweightPolicyById,
            targetGraphVariationId
        );
        const weightedBodyweightKg = policy.includeBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * Number(policy.exerciseBodyWeightRatio || 1)
            : 0;
        const includeBodyweight = policy.includeBodyweight === true && weightedBodyweightKg > 0;
        const peakSlot = resolvePeakPrSlotFromEntry(entry, peak);
        const oneRmForRecommendation = resolveOneRmForFigureRecommendation({
            peak,
            peakSlot,
            includeBodyweight,
            weightedBodyweightKg,
            externalEffectiveLoadKg: Number(effectiveWeightLoad),
        });
        const recommendation = computeTargetValueFromOneRm(
            oneRmForRecommendation,
            targetUnit,
            effectiveWeightLoad,
            weightedBodyweightKg
        );
        if (isFrontLeverFigureDebugFocus({
            referenceList,
            referenceVariationId: payload.referenceVariationId,
            mainExerciseId,
            targetKey,
            name: entry?.name?.fr || entry?.name?.en || null,
        }) && Number(effectiveWeightLoad) === 0) {
            logZeroKgFigureValueFormulaDiagnostics({
                targetKey,
                name: entry?.name,
                peak,
                peakSlot: resolvePeakPrSlotFromEntry(entry, peak),
                policy,
                userWeightKg,
                effectiveWeightLoad,
                oneRmForRecommendation,
                weightedBodyweightKg,
                includeBodyweight,
                recommendation,
            });
        }
        const result = {
            variationId: targetKey,
            variationSignature: entry.variationSignature || targetKey,
            isDirect: entry.isDirect === true,
            name: entry.name || null,
            progressionScope: progressionScopeMeta.progressionScope,
            isGenericProgressionTarget: progressionScopeMeta.isGenericProgressionTarget === true,
            difficultyScore: Number.isFinite(Number(graphDifficultyScore))
                ? Number(graphDifficultyScore)
                : getRecommendationDifficultyScore({ isDirect: entry.isDirect === true, strengthPeak: peak }),
            success: recommendation.success === true,
            reason: recommendation.reason || null,
            message: recommendation.message || null,
            targetUnit,
            effectiveWeightLoad: Number(effectiveWeightLoad),
            effectiveWeightLoadKg: includeBodyweight
                ? toRounded(Number(effectiveWeightLoad) + weightedBodyweightKg, 2)
                : Number(effectiveWeightLoad),
            recommendedValue: recommendation.success ? recommendation.value : null,
            bodyweight: {
                includeBodyweight: policy.includeBodyweight === true,
                userWeightKg: Number.isFinite(Number(userWeightKg)) ? Number(userWeightKg) : null,
                exerciseBodyWeightRatio: Number(policy.exerciseBodyWeightRatio || 1),
                weightedBodyweightKg: toRounded(weightedBodyweightKg, 2)
            },
            usedSets,
            strengthPeak: peak
        };
        if (String(targetKey).includes('6922144d')
            || String(normalizeFigureName(entry?.name?.fr || entry?.name?.en || '')).includes('zercher')) {
            logFigureEntryPipelineStage('whichvalue:zercher-compute', {
                targetKey,
                name: entry?.name?.fr || entry?.name?.en || null,
                usedHistoricalSets,
                usedHistoricalSetsSource: 'pr_unique_ids_in_slots',
                peakSource,
                extrapolationAnchorKey,
                peakFromEntryPrsOneRm: peakFromEntryPrs?.normalizedOneRm ?? null,
                peakFromEntryPrsSetId: peakFromEntryPrs?.setId ?? null,
                finalPeakOneRm: peak?.normalizedOneRm ?? null,
                finalPeakSetId: peak?.setId ?? null,
                finalPeakSourceVariationId: peak?.sourceVariationId ?? null,
                graphDifficultyScore: Number.isFinite(Number(graphDifficultyScore)) ? Number(graphDifficultyScore) : null,
                recommendedValue: result.recommendedValue,
                isDirect: entry?.isDirect === true,
            });
        }
        if (isSmithBenchGuidedFigureDebugFocus({
            referenceList: referenceVariations,
            referenceVariationId: payload.referenceVariationId,
            targetKey,
            name: entry?.name?.fr || entry?.name?.en || null,
        })) {
            logFigureEntryPipelineStage('whichvalue:smith-bench-compute', {
                targetKey,
                name: entry?.name?.fr || entry?.name?.en || null,
                usedHistoricalSets,
                usedHistoricalSetsSource: 'pr_unique_ids_in_slots',
                peakSource,
                extrapolationAnchorKey,
                peakFromEntryPrsOneRm: peakFromEntryPrs?.normalizedOneRm ?? null,
                peakFromEntryPrsSetId: peakFromEntryPrs?.setId ?? null,
                finalPeakOneRm: peak?.normalizedOneRm ?? null,
                finalPeakSetId: peak?.setId ?? null,
                finalPeakSourceVariationId: peak?.sourceVariationId ?? null,
                graphDifficultyScore: Number.isFinite(Number(graphDifficultyScore)) ? Number(graphDifficultyScore) : null,
                recommendedValue: result.recommendedValue,
                isDirect: entry?.isDirect === true,
            });
        }
        if (isFrontLeverFigureDebugFocus({
            referenceList,
            referenceVariationId: payload.referenceVariationId,
            mainExerciseId,
            targetKey,
            name: entry?.name?.fr || entry?.name?.en || null,
        })) {
            logFigureEntryPipelineStage('whichvalue:front-lever-compute', {
                targetKey,
                targetGraphVariationId: String(targetGraphVariationId),
                name: entry?.name?.fr || entry?.name?.en || null,
                isEdgeTarget: entry?.isEdgeTarget === true,
                progressionScope: progressionScopeMeta.progressionScope,
                isGenericProgressionTarget: progressionScopeMeta.isGenericProgressionTarget === true,
                usedHistoricalSets,
                skipExtrapolation,
                peakSource,
                extrapolationAnchorKey,
                graphDifficultyScore: Number.isFinite(Number(graphDifficultyScore)) ? Number(graphDifficultyScore) : null,
                peakFromEntryPrsOneRm: peakFromEntryPrs?.normalizedOneRm ?? null,
                peakFromEntryPrsOneRmForRecommendation: peakFromEntryPrs?.normalizedOneRmForRecommendation ?? null,
                peakFromEntryPrsRawReps: peakFromEntryPrs?.value ?? null,
                peakFromEntryPrsDifficultyRatio: peakFromEntryPrs?.difficultyRatioUsed ?? null,
                finalPeakOneRm: peak?.normalizedOneRm ?? null,
                finalPeakOneRmForRecommendation: peak?.normalizedOneRmForRecommendation ?? null,
                finalPeakRawReps: peak?.value ?? null,
                finalPeakDifficultyRatio: peak?.difficultyRatioUsed ?? null,
                finalPeakExtrapolated: peak?.extrapolated === true,
                oneRmUsedForRecommendation: oneRmForRecommendation,
                recommendedValue: result.recommendedValue ?? null,
                success: result.success !== false,
                reason: result.reason ?? null,
            });
        }
        return result;
    }));
    const recommendationsDeduped = dedupeFigureRecommendationsByTargetKey(recommendations);
    logFigureRecommendationsDedupeDiff('whichvalue', recommendations, recommendationsDeduped);
    return {
        success: true,
        referenceVariationId: String(payload.referenceVariationId),
        mainExerciseId: String(payload.mainExerciseId),
        targetUnit,
        effectiveWeightLoad: Number(effectiveWeightLoad),
        recommendations: sortRecommendationsByRecommendedLoadDescending(recommendationsDeduped),
        meta: {
            ...payload.meta,
            includeAllGraphTargetsRequested: Boolean(includeAllGraphTargets),
            includeAllGraphTargetsApplied: includeAll,
            includeAllGraphTargets: includeAll,
            expandGenericTargets: expandGenericTargets === true
        }
    };
}

module.exports = {
    computeRecommendedWeightFigure,
    computeRecommendedValueFigure
};

