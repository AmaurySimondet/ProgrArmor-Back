const setLib = require('./set');
const Variation = require('../schema/variation');
const VariationProgressionEdge = require('../schema/variationProgressionEdge');
const UserMeasure = require('../schema/userMeasure');
const { whichWeight: { MAX_BRZYCKI_TARGET_REPS } } = require('../constants');
const { secondsToEquivalentReps } = require('../utils/oneRepMax');
const { getDifficultyRatio, buildAdjacencyList } = require('./variationDifficultyGraph');

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

function kgToLbsOrNull(valueKg) {
    const kg = Number(valueKg);
    if (!Number.isFinite(kg)) return null;
    return Math.round((kg * 2.2046226218) * 100) / 100;
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

async function resolveMainExerciseIdForProgression(mainExerciseId) {
    if (!mainExerciseId) return null;
    const idStr = String(mainExerciseId);
    const doc = await Variation.findById(idStr, { equivalentTo: 1 }).lean();
    const first = doc?.equivalentTo?.[0];
    return first != null ? String(first) : idStr;
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

function computeTargetValueFromOneRm(oneRmKg, targetUnit, effectiveWeightLoadRaw, weightedBodyweightKg = 0) {
    const targetExternal = Number(effectiveWeightLoadRaw);
    if (!Number.isFinite(targetExternal)) {
        return {
            success: false,
            reason: 'INVALID_INPUT',
            message: 'Charge cible invalide / Invalid target load.'
        };
    }

    const bodyweight = Number.isFinite(Number(weightedBodyweightKg)) ? Number(weightedBodyweightKg) : 0;
    const oneRmEffective = Number(oneRmKg);
    const targetEffectiveLoad = targetExternal + bodyweight;

    if (!Number.isFinite(oneRmEffective) || oneRmEffective <= 0 || !Number.isFinite(targetEffectiveLoad) || targetEffectiveLoad <= 0) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une valeur fiable avec les données actuelles.'
        };
    }

    const candidates = [];
    const rBrzycki = 37 - ((36 * targetEffectiveLoad) / oneRmEffective);
    if (Number.isFinite(rBrzycki)) candidates.push(rBrzycki);
    const rEpley = 30 * ((oneRmEffective / targetEffectiveLoad) - 1);
    if (Number.isFinite(rEpley)) candidates.push(rEpley);

    if (!candidates.length) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une valeur fiable avec les données actuelles.'
        };
    }

    const repsEquivalent = Math.min(36, Math.max(1, candidates.reduce((sum, v) => sum + v, 0) / candidates.length));
    if (!Number.isFinite(repsEquivalent) || repsEquivalent <= 0) {
        return {
            success: false,
            reason: 'COMPUTATION_FAILED',
            message: 'Impossible de proposer une valeur fiable avec les données actuelles.'
        };
    }

    if (targetUnit === 'repetitions') {
        return { success: true, value: Math.round(repsEquivalent * 10) / 10 };
    }
    if (targetUnit === 'seconds') {
        const seconds = repsEquivalentToSeconds(repsEquivalent);
        if (!Number.isFinite(seconds) || seconds <= 0) {
            return {
                success: false,
                reason: 'COMPUTATION_FAILED',
                message: 'Impossible de proposer une valeur fiable avec les données actuelles.'
            };
        }
        return { success: true, value: Math.round(seconds) };
    }
    return {
        success: false,
        reason: 'INVALID_INPUT',
        message: 'Unité cible invalide / Invalid target unit.'
    };
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
            if (!best || normalizedOneRm > Number(best.normalizedOneRm)) {
                best = {
                    rmKey: key,
                    unit: unitKey,
                    setId: set?._id != null ? String(set._id) : null,
                    date: set?.date || null,
                    value: toNumberOrNull(set?.value),
                    weightLoad: toNumberOrNull(set?.weightLoad),
                    normalizedOneRm: toRounded(normalizedOneRm, 3),
                    normalizedOneRmRaw: toRounded(normalizedOneRmRaw, 3),
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

function sortRecommendationsByRecommendedLoadDescending(recommendations) {
    if (!Array.isArray(recommendations)) return [];
    const sorted = [...recommendations].sort((a, b) => {
        const aLoad = getRecommendationLoadScore(a);
        const bLoad = getRecommendationLoadScore(b);
        const aHasLoad = Number.isFinite(aLoad);
        const bHasLoad = Number.isFinite(bLoad);
        if (aHasLoad && !bHasLoad) return -1;
        if (!aHasLoad && bHasLoad) return 1;
        if (aHasLoad && bHasLoad && aLoad !== bLoad) return bLoad - aLoad;
        const aDifficulty = getRecommendationDifficultyScore(a);
        const bDifficulty = getRecommendationDifficultyScore(b);
        if (aDifficulty !== bDifficulty) return aDifficulty - bDifficulty;
        const aName = typeof a?.name === 'string' ? a.name : '';
        const bName = typeof b?.name === 'string' ? b.name : '';
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

async function filterOutDetailVariantsWhenCombinationExists(recommendations) {
    if (!Array.isArray(recommendations) || recommendations.length <= 1) return recommendations || [];
    const ids = recommendations
        .map((r) => String(r?.variationId || ''))
        .filter(Boolean);
    const docs = await Variation.find(
        { _id: { $in: ids } },
        { _id: 1, isExercice: 1, equivalentTo: 1 }
    ).lean();
    const docById = new Map(docs.map((d) => [String(d._id), d]));
    const presentIds = new global.Set(ids);
    const exerciseDocs = docs.filter((d) => d?.isExercice === true);
    const kept = [];
    const removed = [];
    for (const rec of recommendations) {
        const id = String(rec?.variationId || '');
        const doc = docById.get(id);
        if (!doc) {
            kept.push(rec);
            continue;
        }
        const isExercise = doc?.isExercice === true;
        const equivalentIds = Array.isArray(doc?.equivalentTo) ? doc.equivalentTo.map((v) => String(v)) : [];
        const hasExerciseEquivalentPresent = equivalentIds.some((eqId) => {
            if (!presentIds.has(eqId)) return false;
            return docById.get(eqId)?.isExercice === true;
        });
        const replacedByExerciseId = !isExercise
            ? (
                exerciseDocs.find((exerciseDoc) => {
                    if (!presentIds.has(String(exerciseDoc._id))) return false;
                    const eq = Array.isArray(exerciseDoc?.equivalentTo)
                        ? exerciseDoc.equivalentTo.map((v) => String(v))
                        : [];
                    return eq.includes(id);
                })?._id
            )
            : null;
        if (!isExercise && (hasExerciseEquivalentPresent || replacedByExerciseId)) {
            removed.push({
                variationId: id,
                replacedByExerciseEquivalent: true,
                replacedByVariationId: replacedByExerciseId ? String(replacedByExerciseId) : null
            });
            continue;
        }
        const implicitFromVariationId = rec?.implicitFromVariationId ? String(rec.implicitFromVariationId) : null;
        const hasImplicitTargetPresent = implicitFromVariationId
            && presentIds.has(implicitFromVariationId)
            && recommendations.some((item) => String(item?.variationId || '') === implicitFromVariationId && item?.success === true);
        if (rec?.isDirect === true && hasImplicitTargetPresent) {
            removed.push({
                variationId: id,
                removedAsImplicitAlias: true,
                replacedByVariationId: implicitFromVariationId
            });
            continue;
        }
        kept.push(rec);
    }
    // Si l'exercice direct est en échec mais qu'une variante "full/complet" réussie existe,
    // on retire l'entrée directe pour éviter un doublon UX ambigu (cas Dragon Flag / Full).
    const hasSuccessfulFullVariant = kept.some((rec) => {
        if (rec?.isDirect === true || rec?.success !== true) return false;
        const n = normalizeFigureName(rec?.name?.fr || rec?.name?.en || "");
        return n.includes("full") || n.includes("complet");
    });
    if (hasSuccessfulFullVariant) {
        const before = kept.length;
        const stillKept = [];
        for (const rec of kept) {
            const shouldDrop = rec?.isDirect === true && rec?.success !== true;
            if (shouldDrop) {
                removed.push({
                    variationId: String(rec?.variationId || ""),
                    removedAsDirectNoDataWhenFullExists: true
                });
                continue;
            }
            stillKept.push(rec);
        }
        kept.length = 0;
        kept.push(...stillKept);
    }
    return kept;
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
    return {
        rmKey: 'EXTRAPOLATED',
        unit: anchorPeak?.unit || 'repetitions',
        setId: anchorPeak?.setId || null,
        date: anchorPeak?.date || null,
        value: anchorPeak?.value ?? null,
        weightLoad: anchorPeak?.weightLoad ?? null,
        normalizedOneRm: toRounded(normalizedOneRm, 3),
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

async function buildTargetBodyweightPolicyMap(targetIds, normalizedMainExerciseId = null, referenceVariationId = null) {
    const uniq = [...new global.Set((targetIds || []).map((id) => String(id)))];
    if (!uniq.length) return new Map();
    const docs = await Variation.find(
        { _id: { $in: uniq } },
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
    if (normalizedMainExerciseId) {
        const edges = await VariationProgressionEdge.find(
            {
                isActive: true,
                isExerciseVariation: false,
                $and: [
                    {
                        $or: [
                            { contextVariationId: normalizedMainExerciseId },
                            { contextVariationId: null }
                        ]
                    },
                    {
                        $or: [
                            { fromVariationId: { $in: uniq } },
                            { toVariationId: { $in: uniq } }
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

async function getFigureDetailedEntries({
    userId,
    mainExerciseId,
    referenceVariations,
    includeAllGraphTargets = true,
    maxTargets = 40,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined
}) {
    const payload = await setLib.getFigureDetailedPRs({
        userId,
        exercice,
        categories,
        dateMin,
        unilateralSide,
        referenceVariations,
        mainExerciseId,
        includeAllGraphTargets,
        maxTargets
    });
    return payload;
}

async function computeRecommendedWeightFigure({
    userId,
    mainExerciseId,
    referenceVariations,
    targetUnit,
    targetValue,
    includeAllGraphTargets = true,
    expandGenericTargets = true,
    maxTargets = 40,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined
}) {
    if (targetUnit !== 'repetitions' && targetUnit !== 'seconds') {
        return { success: false, reason: 'INVALID_INPUT', message: 'Unité cible invalide / Invalid target unit.' };
    }
    const includeAll = expandGenericTargets === true ? true : Boolean(includeAllGraphTargets);
    const normalizedMainExerciseId = await resolveMainExerciseIdForProgression(mainExerciseId);
    const payload = await getFigureDetailedEntries({
        userId,
        mainExerciseId,
        referenceVariations,
        includeAllGraphTargets: includeAll,
        maxTargets,
        exercice,
        categories,
        dateMin,
        unilateralSide
    });
    const targetIds = payload.entries.map((e) => String(e.variationId));
    const bodyweightPolicyById = await buildTargetBodyweightPolicyMap(
        targetIds,
        normalizedMainExerciseId,
        payload.referenceVariationId
    );
    const userMeasures = await UserMeasure.find({ userId }, { measuredAt: 1, 'weight.kg': 1 }).sort({ measuredAt: 1 }).lean();
    const userWeightKg = resolveUserWeightKgForDate(userMeasures, new Date());
    const { anchorPeak, anchorVariationId } = pickAnchorPeakFromEntries(payload.entries);
    const anchorCandidates = getAnchorCandidatesFromEntries(payload.entries);
    const adjacency = await buildAdjacencyList({ contextVariationId: payload.mainExerciseId });
    const recommendations = await Promise.all(payload.entries.map(async (entry) => {
        const usedHistoricalSets = getUsedHistoricalSetsFromDetailedPrs(entry?.prs);
        const usedSets = {
            fetchedHistoricalSets: usedHistoricalSets,
            usedHistoricalSets,
            usedSessionSets: 0,
            usedTotalSets: usedHistoricalSets,
            maxSetsRequested: null
        };
        let peak = collectBestPeakFromDetailedPrs(entry?.prs);
        if ((!peak || !Number.isFinite(Number(peak.normalizedOneRm))) && anchorCandidates.length > 0) {
            for (const candidate of anchorCandidates) {
                peak = await extrapolatePeakFromAnchor({
                    anchorPeak: candidate.peak,
                    anchorVariationId: candidate.variationId,
                    targetVariationId: String(entry.variationId),
                    contextVariationId: payload.mainExerciseId,
                    adjacency
                });
                if (peak && Number.isFinite(Number(peak.normalizedOneRm))) {
                    break;
                }
            }
        }
        if (!peak || !Number.isFinite(Number(peak.normalizedOneRm))) {
            return {
                variationId: String(entry.variationId),
                isDirect: entry.isDirect === true,
                name: entry.name || null,
                success: false,
                reason: 'NO_DATA',
                message: 'Aucune série exploitable pour cette variation.',
                targetUnit,
                targetValue: Number(targetValue),
                usedSets,
                strengthPeak: null
            };
        }
        const targetPolicy = bodyweightPolicyById.get(String(entry.variationId)) || { includeBodyweight: false, exerciseBodyWeightRatio: 1 };
        const sourceVariationId = peak?.sourceVariationId ? String(peak.sourceVariationId) : null;
        const targetVariationId = String(entry.variationId);
        const difficultyRatioUsed = Number(peak?.difficultyRatioUsed);
        const shouldUseSourcePolicy = Boolean(
            sourceVariationId
            && sourceVariationId !== targetVariationId
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
        const recommendation = computeTargetLoadFromOneRm(
            Number(peak.normalizedOneRm),
            targetUnit,
            targetValue,
            weightedBodyweightKg
        );
        const loadKg = recommendation.success ? Number(recommendation.loadKg) : null;
        return {
            variationId: String(entry.variationId),
            isDirect: entry.isDirect === true,
            name: entry.name || null,
            difficultyScore: getRecommendationDifficultyScore({ isDirect: entry.isDirect === true, strengthPeak: peak }),
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
    const recommendationsDeduped = await filterOutDetailVariantsWhenCombinationExists(recommendationsWithImplicitFull);
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
    includeAllGraphTargets = true,
    expandGenericTargets = true,
    maxTargets = 40,
    exercice = null,
    categories = null,
    dateMin = null,
    unilateralSide = undefined
}) {
    if (targetUnit !== 'repetitions' && targetUnit !== 'seconds') {
        return { success: false, reason: 'INVALID_INPUT', message: 'Unité cible invalide / Invalid target unit.' };
    }
    const includeAll = expandGenericTargets === true ? true : Boolean(includeAllGraphTargets);
    const normalizedMainExerciseId = await resolveMainExerciseIdForProgression(mainExerciseId);
    const payload = await getFigureDetailedEntries({
        userId,
        mainExerciseId,
        referenceVariations,
        includeAllGraphTargets: includeAll,
        maxTargets,
        exercice,
        categories,
        dateMin,
        unilateralSide
    });
    const targetIds = payload.entries.map((e) => String(e.variationId));
    const bodyweightPolicyById = await buildTargetBodyweightPolicyMap(
        targetIds,
        normalizedMainExerciseId,
        payload.referenceVariationId
    );
    const userMeasures = await UserMeasure.find({ userId }, { measuredAt: 1, 'weight.kg': 1 }).sort({ measuredAt: 1 }).lean();
    const userWeightKg = resolveUserWeightKgForDate(userMeasures, new Date());
    const { anchorPeak, anchorVariationId } = pickAnchorPeakFromEntries(payload.entries);
    const anchorCandidates = getAnchorCandidatesFromEntries(payload.entries);
    const adjacency = await buildAdjacencyList({ contextVariationId: payload.mainExerciseId });

    const recommendations = await Promise.all(payload.entries.map(async (entry) => {
        const usedHistoricalSets = getUsedHistoricalSetsFromDetailedPrs(entry?.prs);
        const usedSets = {
            fetchedHistoricalSets: usedHistoricalSets,
            usedHistoricalSets,
            usedSessionSets: 0,
            usedTotalSets: usedHistoricalSets,
            maxSetsRequested: null
        };
        let peak = collectBestPeakFromDetailedPrs(entry?.prs);
        if ((!peak || !Number.isFinite(Number(peak.normalizedOneRm))) && anchorCandidates.length > 0) {
            for (const candidate of anchorCandidates) {
                peak = await extrapolatePeakFromAnchor({
                    anchorPeak: candidate.peak,
                    anchorVariationId: candidate.variationId,
                    targetVariationId: String(entry.variationId),
                    contextVariationId: payload.mainExerciseId,
                    adjacency
                });
                if (peak && Number.isFinite(Number(peak.normalizedOneRm))) {
                    break;
                }
            }
        }
        if (!peak || !Number.isFinite(Number(peak.normalizedOneRm))) {
            return {
                variationId: String(entry.variationId),
                isDirect: entry.isDirect === true,
                name: entry.name || null,
                success: false,
                reason: 'NO_DATA',
                message: 'Aucune série exploitable pour cette variation.',
                targetUnit,
                effectiveWeightLoad: Number(effectiveWeightLoad),
                usedSets,
                strengthPeak: null
            };
        }
        const policy = bodyweightPolicyById.get(String(entry.variationId)) || { includeBodyweight: false, exerciseBodyWeightRatio: 1 };
        const weightedBodyweightKg = policy.includeBodyweight && Number.isFinite(Number(userWeightKg))
            ? Number(userWeightKg) * Number(policy.exerciseBodyWeightRatio || 1)
            : 0;
        const recommendation = computeTargetValueFromOneRm(
            Number(peak.normalizedOneRm),
            targetUnit,
            effectiveWeightLoad,
            weightedBodyweightKg
        );
        return {
            variationId: String(entry.variationId),
            isDirect: entry.isDirect === true,
            name: entry.name || null,
            difficultyScore: getRecommendationDifficultyScore({ isDirect: entry.isDirect === true, strengthPeak: peak }),
            success: recommendation.success === true,
            reason: recommendation.reason || null,
            message: recommendation.message || null,
            targetUnit,
            effectiveWeightLoad: Number(effectiveWeightLoad),
            effectiveWeightLoadKg: Number(effectiveWeightLoad),
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
    }));
    return {
        success: true,
        referenceVariationId: String(payload.referenceVariationId),
        mainExerciseId: String(payload.mainExerciseId),
        targetUnit,
        effectiveWeightLoad: Number(effectiveWeightLoad),
        recommendations: sortRecommendationsByRecommendedLoadDescending(recommendations),
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

