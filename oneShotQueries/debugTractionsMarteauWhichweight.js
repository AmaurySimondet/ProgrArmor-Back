/**
 * Diagnostic whichweight PDC : compare legacy / figure / whichvalue + référence mathématique.
 * Cas cible : Tractions + prise Marteau (ou variation passée en argument).
 *
 * Usage:
 *   node oneShotQueries/debugTractionsMarteauWhichweight.js
 *   node oneShotQueries/debugTractionsMarteauWhichweight.js <userId> [exerciseVariationId] [detailVariationId]
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');
const whichweight = require('../lib/whichweight');
const whichfigure = require('../lib/whichfigure');
const { resolveMainExerciseIdForProgression } = require('../lib/progressionResolution');
const { resolveNormalizedOneRmForRecommendation } = require('../utils/oneRepMax');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';
const TARGET_REPS = 10;
const WINDOW_DAYS = 180;
const MAX_BRZYCKI_TARGET_REPS = 15;

function roundKg(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Charge externe depuis 1RM charge-utile + soustraction PDC (legacy whichweight). */
function inverseLoadFromChargeUtileMinusBw(oneRmChargeUtile, targetReps, weightedBw) {
    const r = Math.min(36, Math.max(1, targetReps));
    const denom = 1 + r / 30;
    const wEpley = (oneRmChargeUtile / denom) - weightedBw;
    let wBrzycki = null;
    if (r <= MAX_BRZYCKI_TARGET_REPS) {
        wBrzycki = (oneRmChargeUtile * ((37 - r) / 36)) - weightedBw;
    }
    const candidates = [wEpley, wBrzycki].filter((v) => Number.isFinite(v));
    if (!candidates.length) return null;
    return Math.round((candidates.reduce((s, v) => s + v, 0) / candidates.length) * 2) / 2;
}

/** Charge externe depuis 1RM total (PDC inclus) puis retrait PDC (aligné whichvalue-figure). */
function inverseLoadFromTotalOneRmMinusBw(oneRmTotal, targetReps, weightedBw) {
    const r = Math.min(36, Math.max(1, targetReps));
    const denom = 1 + r / 30;
    const wEpley = (oneRmTotal / denom) - weightedBw;
    let wBrzycki = null;
    if (r <= MAX_BRZYCKI_TARGET_REPS) {
        wBrzycki = (oneRmTotal * ((37 - r) / 36)) - weightedBw;
    }
    const candidates = [wEpley, wBrzycki].filter((v) => Number.isFinite(v));
    if (!candidates.length) return null;
    return Math.round((candidates.reduce((s, v) => s + v, 0) / candidates.length) * 2) / 2;
}

/** Charge externe brute depuis 1RM charge-utile SANS soustraire PDC (bug actuel whichweight-figure). */
function inverseLoadFromChargeUtileNoBwSub(oneRmChargeUtile, targetReps) {
    const r = Math.min(36, Math.max(1, targetReps));
    const denom = 1 + r / 30;
    const wEpley = oneRmChargeUtile / denom;
    let wBrzycki = null;
    if (r <= MAX_BRZYCKI_TARGET_REPS) {
        wBrzycki = oneRmChargeUtile * ((37 - r) / 36);
    }
    const candidates = [wEpley, wBrzycki].filter((v) => Number.isFinite(v));
    if (!candidates.length) return null;
    return Math.round((candidates.reduce((s, v) => s + v, 0) / candidates.length) * 2) / 2;
}

function resolveOneRmForRecommendationFromPeak(peak, bodyweight, peakSlot = null) {
    const weightedBw = Number(bodyweight?.weightedBodyweightKg) || 0;
    const externalLoad = Number.isFinite(Number(peak?.weightLoad)) ? Number(peak.weightLoad) : 0;
    const repsEquivalent = Number.isFinite(Number(peakSlot?.repsEquivalent))
        ? Number(peakSlot.repsEquivalent)
        : Number(peak?.value);
    return resolveNormalizedOneRmForRecommendation({
        normalizedOneRm: peak?.normalizedOneRm,
        brzyckiWithBodyweight: peakSlot?.brzyckiWithBodyweight ?? peakSlot?.brzycki_with_bodyweight,
        epleyWithBodyweight: peakSlot?.epleyWithBodyweight ?? peakSlot?.epley_with_bodyweight,
        normalizedBrzycki: peakSlot?.normalizedBrzycki ?? peakSlot?.brzycki,
        normalizedEpley: peakSlot?.normalizedEpley ?? peakSlot?.epley,
        weightedBodyweightKg: weightedBw,
        repsEquivalent,
        difficultyFactor: peakSlot?.difficultyFactor ?? 1,
        includeBodyweight: bodyweight?.includeBodyweight === true,
        externalEffectiveLoadKg: externalLoad,
        effectiveLoadKgForBrzyckiCheck: externalLoad + weightedBw,
    });
}

function getIsoDateLocalDaysAgo(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function findTractionsMarteauVariations() {
    const docs = await Variation.find(
        {
            $or: [
                { 'name.fr': /traction/i },
                { 'name.en': /pull.?up/i },
            ],
        },
        { name: 1, isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1, type: 1 },
    ).lean();
    const marteau = docs.filter((doc) => /marteau|hammer|neutral/i.test(
        `${doc?.name?.fr || ''} ${doc?.name?.en || ''}`,
    ));
    const tractions = docs.filter((doc) => /traction|pull/i.test(
        `${doc?.name?.fr || ''} ${doc?.name?.en || ''}`,
    ));
    return { marteau, tractions, all: docs };
}

async function run() {
    const userId = process.argv[2] || DEFAULT_USER_ID;
    const forcedVariationId = process.argv[3] || null;

    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    await mongoose.connect(mongoUrl + database);

    let variationIds = forcedVariationId ? [forcedVariationId] : [];
    if (!variationIds.length) {
        const { marteau, tractions } = await findTractionsMarteauVariations();
        console.log('\n=== Variations Tractions / Marteau trouvées ===');
        console.log('Marteau:', marteau.map((d) => ({ id: String(d._id), name: d.name })));
        console.log('Tractions (sample):', tractions.slice(0, 8).map((d) => ({ id: String(d._id), name: d.name })));

        const exercise = tractions.find((d) => d.isExercice === true) || tractions[0];
        const detail = marteau.find((d) => d.isExercice !== true) || marteau[0];
        if (exercise) variationIds.push(String(exercise._id));
        if (detail && !variationIds.includes(String(detail._id))) variationIds.push(String(detail._id));
    }

    if (!variationIds.length) {
        console.error('Aucune variation Tractions/Marteau trouvée — passe un variationId en argument.');
        process.exit(1);
    }

    console.log('\n=== Config test ===', { userId, variationIds, targetReps: TARGET_REPS });

    const dateMin = getIsoDateLocalDaysAgo(WINDOW_DAYS);
    const variationsPayload = variationIds.map((id) => ({ variation: id }));

    console.log('\n--- WORKOUT PATH: whichweight (legacy) ---');
    const legacy = await whichweight.computeRecommendedLoad({
        userId,
        variations: variationsPayload,
        targetUnit: 'repetitions',
        targetValue: TARGET_REPS,
        sessionSets: [],
    });
    console.log(JSON.stringify({
        success: legacy.success,
        loadKg: legacy.loadKg,
        loadKgWithBodyweight: legacy.loadKgWithBodyweight,
        usedSets: legacy.usedSets,
        userWeightKg: legacy.userWeightKg,
        exerciseBodyWeightRatioUsed: legacy.exerciseBodyWeightRatioUsed,
        strengthPeak: legacy.strengthPeak,
        targetVariation: legacy.targetVariation,
    }, null, 2));

    const mainExerciseId = await resolveMainExerciseIdForProgression(variationIds[0]);
    console.log('\n--- PROFILE PATH: whichweight-figure ---', { mainExerciseId, dateMin });
    const figure = await whichfigure.computeRecommendedWeightFigure({
        userId,
        mainExerciseId,
        referenceVariations: variationIds,
        targetUnit: 'repetitions',
        targetValue: TARGET_REPS,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        dateMin,
        lateralMode: 'bilateral',
    });

    const direct = (figure.recommendations || []).find((e) => e?.isDirect === true)
        || (figure.recommendations || []).find((e) => String(e?.variationId || '').includes(String(variationIds[0])));
    console.log(JSON.stringify({
        success: figure.success,
        referenceVariationId: figure.referenceVariationId,
        directRecommendation: direct ? {
            name: direct.name,
            recommendedLoadKg: direct.recommendedLoadKg,
            recommendedEffectiveWeightLoadKg: direct.recommendedEffectiveWeightLoadKg,
            usedSets: direct.usedSets,
            strengthPeak: direct.strengthPeak,
            bodyweight: direct.bodyweight,
        } : null,
        recommendationCount: figure.recommendations?.length ?? 0,
    }, null, 2));

    console.log('\n--- CROSS-CHECK: whichvalue-figure @0kg (même pic, sens inverse) ---');
    const valueFigure = await whichfigure.computeRecommendedValueFigure({
        userId,
        mainExerciseId,
        referenceVariations: variationIds,
        targetUnit: 'repetitions',
        effectiveWeightLoad: 0,
        includeAllGraphTargets: true,
        expandGenericTargets: true,
        maxTargets: 40,
        dateMin,
        lateralMode: 'bilateral',
    });
    const valueDirect = (valueFigure.recommendations || []).find((e) => e?.isDirect === true);
    console.log(JSON.stringify({
        directRecommendedValueAt0kg: valueDirect?.recommendedValue ?? null,
        directPeakReps: valueDirect?.strengthPeak?.value ?? null,
        directPeakNormalizedOneRm: valueDirect?.strengthPeak?.normalizedOneRm ?? null,
        directPeakNormalizedOneRmForRecommendation: valueDirect?.strengthPeak?.normalizedOneRmForRecommendation ?? null,
        bodyweight: valueDirect?.bodyweight ?? null,
    }, null, 2));

    const peak = direct?.strengthPeak ?? null;
    const bw = direct?.bodyweight ?? {};
    const weightedBw = Number(bw.weightedBodyweightKg) || 0;
    const chargeUtile = Number(peak?.normalizedOneRm);
    const storedRecoOneRm = Number(peak?.normalizedOneRmForRecommendation);
    const directEntryFromDetailed = await (async () => {
        try {
            const setLib = require('../lib/set');
            const detailed = await setLib.getFigureDetailedPRs({
                userId,
                referenceVariations: variationIds,
                mainExerciseId,
                dateMin,
                lateralMode: 'bilateral',
                includeAllGraphTargets: true,
                expandGenericTargets: true,
                maxTargets: 40,
            });
            const entry = (detailed?.entries || []).find((e) => e?.isDirect === true);
            if (!entry?.prs) return null;
            const peakSlot = entry.prs?.[peak?.rmKey]?.[peak?.unit || 'repetitions'] ?? null;
            return { entry, peakSlot };
        } catch {
            return null;
        }
    })();
    const peakSlot = directEntryFromDetailed?.peakSlot ?? null;
    const resolvedRecoOneRm = peak
        ? resolveOneRmForRecommendationFromPeak(peak, bw, peakSlot)
        : null;
    const oneRmTotalForWhichvalue = Number.isFinite(storedRecoOneRm) && storedRecoOneRm > chargeUtile
        ? storedRecoOneRm
        : resolvedRecoOneRm;

    console.log('\n=== ANALYSE RACINE (pic direct Tractions+Marteau) ===');
    console.log({
        peakSet: peak ? {
            rmKey: peak.rmKey,
            setId: peak.setId,
            reps: peak.value,
            weightLoadExternal: peak.weightLoad,
        } : null,
        oneRmChargeUtile_graph: chargeUtile,
        oneRmForRecommendation_stored: storedRecoOneRm,
        oneRmForRecommendation_resolvedWithPeakSlot: resolvedRecoOneRm,
        oneRmTotalUsedByWhichvalue: oneRmTotalForWhichvalue,
        weightedBodyweightKg: weightedBw,
        peakLooksCoherent: Number.isFinite(chargeUtile) && chargeUtile > 0
            ? `~${chargeUtile} kg charge utile pour ${peak?.value} reps @ ${peak?.weightLoad} kg externe`
            : null,
    });

    console.log('\n=== MODÈLES MATHÉMATIQUES pour', TARGET_REPS, 'reps ===');
    const models = {
        A_legacy_whichweight: {
            formula: 'inverse(chargeUtile1RM) - PDC',
            loadKg: Number.isFinite(chargeUtile) ? inverseLoadFromChargeUtileMinusBw(chargeUtile, TARGET_REPS, weightedBw) : null,
            effectiveKg: null,
        },
        B_bug_whichweight_figure_actuel: {
            formula: 'inverse(chargeUtile1RM) SANS soustraire PDC',
            loadKg: Number.isFinite(chargeUtile) ? inverseLoadFromChargeUtileNoBwSub(chargeUtile, TARGET_REPS) : null,
            effectiveKg: null,
        },
        C_coherent_avec_whichvalue_figure: {
            formula: 'inverse(oneRmForRecommendation total) - PDC',
            oneRmInput: oneRmTotalForWhichvalue,
            loadKg: Number.isFinite(oneRmTotalForWhichvalue)
                ? inverseLoadFromTotalOneRmMinusBw(oneRmTotalForWhichvalue, TARGET_REPS, weightedBw)
                : null,
            effectiveKg: null,
        },
    };
    for (const [key, model] of Object.entries(models)) {
        if (Number.isFinite(model.loadKg) && Number.isFinite(weightedBw)) {
            model.effectiveKg = roundKg(model.loadKg + weightedBw);
        }
    }
    console.log(models);

    console.log('\n=== COMPARAISON AUX RÉSULTATS API ===');
    const apiComparison = {
        legacy_whichweight: {
            loadKg: legacy.loadKg,
            loadKgWithBodyweight: legacy.loadKgWithBodyweight,
            oneRmUsed: legacy.strengthPeak?.oneRmKg,
            historicalSets: legacy.usedSets?.usedHistoricalSets,
        },
        whichweight_figure_direct: {
            loadKg: direct?.recommendedLoadKg,
            effectiveKg: direct?.recommendedEffectiveWeightLoadKg,
            oneRmUsedInCode: chargeUtile,
            oneRmShouldUse: oneRmTotalForWhichvalue,
            historicalSets: direct?.usedSets?.usedHistoricalSets,
        },
        whichvalue_figure_at0kg: {
            recommendedReps: valueDirect?.recommendedValue,
            peakReps: valueDirect?.strengthPeak?.value,
        },
        deltas: {
            legacy_vs_figure: Number.isFinite(Number(legacy.loadKg)) && Number.isFinite(Number(direct?.recommendedLoadKg))
                ? roundKg(Number(legacy.loadKg) - Number(direct.recommendedLoadKg))
                : null,
            figure_vs_modelB: Number.isFinite(Number(direct?.recommendedLoadKg)) && Number.isFinite(models.B_bug_whichweight_figure_actuel.loadKg)
                ? roundKg(Number(direct.recommendedLoadKg) - models.B_bug_whichweight_figure_actuel.loadKg)
                : null,
            figure_vs_modelC: Number.isFinite(Number(direct?.recommendedLoadKg)) && Number.isFinite(models.C_coherent_avec_whichvalue_figure.loadKg)
                ? roundKg(Number(direct.recommendedLoadKg) - models.C_coherent_avec_whichvalue_figure.loadKg)
                : null,
        },
    };
    console.log(apiComparison);

    const figureMatchesCoherentModel = apiComparison.deltas.figure_vs_modelC === 0;
    const figureMatchesBuggyModel = apiComparison.deltas.figure_vs_modelB === 0;
    const valueSeemsCoherent = Number.isFinite(Number(valueDirect?.recommendedValue))
        && Number.isFinite(Number(valueDirect?.strengthPeak?.value))
        && Math.abs(Number(valueDirect.recommendedValue) - Number(valueDirect.strengthPeak.value)) < 5;

    console.log('\n=== VERDICT ===');
    if (figureMatchesCoherentModel) {
        console.log([
            'OK: whichweight-figure aligné sur modèle C (oneRmForRecommendation total − PDC).',
            `Charge directe: ${direct?.recommendedLoadKg} kg externe, ${direct?.recommendedEffectiveWeightLoadKg} kg effective.`,
            valueSeemsCoherent
                ? 'whichvalue-figure @0kg cohérent avec le pic.'
                : 'whichvalue-figure: vérifier manuellement.',
            legacy.loadKg !== direct?.recommendedLoadKg
                ? `Note: whichweight legacy (profil) reste à ${legacy.loadKg} kg — API différente / plus de sets.`
                : null,
        ].filter(Boolean).join('\n'));
    } else if (figureMatchesBuggyModel) {
        console.log([
            'BUG: whichweight-figure utilise encore charge utile sans soustraction PDC.',
            'Fix attendu: resolveOneRmForFigureRecommendation + inverse(total1RM) - PDC.',
        ].join('\n'));
    } else {
        console.log('Écart figure vs modèles — vérifier les logs [whichfigure][whichweight-load-formula].');
    }

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
