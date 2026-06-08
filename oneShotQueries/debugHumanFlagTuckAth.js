/**
 * Compare ATH (Pic de force) : workout getPRs vs profile getProgressionPRs
 * pour le drapeau tuck (692214541c858345acc2d435).
 *
 * Usage:
 *   node oneShotQueries/debugHumanFlagTuckAth.js
 *   node oneShotQueries/debugHumanFlagTuckAth.js <userId>
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');
const Set = require('../schema/seanceset');
const { resolvePrComparisonOneRmKg } = require('../utils/set');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';
const HUMAN_FLAG_TUCK_EX_ID = '692214541c858345acc2d435';
const GENERIC_TUCK_DETAIL_ID = '669c3609218324e0b7682b2b';

function pickAth(prs) {
    const ath = prs?.ATH?.repetitions;
    if (!ath) return null;
    return {
        setId: ath._id != null ? String(ath._id) : null,
        value: ath.value,
        weightLoad: ath.weightLoad,
        effectiveWeightLoad: ath.effectiveWeightLoad,
        normalizedOneRm: ath.normalizedOneRm,
        brzycki: ath.brzycki,
        epley: ath.epley,
        oneRmKg: resolvePrComparisonOneRmKg(ath),
        date: ath.date,
        variations: (ath.variations || []).map((v) => String(v?.variation || v)),
    };
}

function summarizeAllAthCandidates(augmentedSets) {
    return (augmentedSets || [])
        .filter((s) => s?.unit === 'repetitions')
        .map((s) => ({
            setId: s._id != null ? String(s._id) : null,
            value: s.value,
            weightLoad: s.weightLoad,
            normalizedOneRm: s.normalizedOneRm,
            oneRmKg: resolvePrComparisonOneRmKg(s),
            date: s.date,
            variations: (s.variations || []).map((v) => String(v?.variation || v)),
        }))
        .sort((a, b) => (b.oneRmKg ?? 0) - (a.oneRmKg ?? 0));
}

async function findExerciceIdForVariation(userId, variationId) {
    const row = await Set.findOne(
        {
            user: new mongoose.Types.ObjectId(userId),
            'variations.variation': new mongoose.Types.ObjectId(variationId),
        },
        { exercice: 1 },
    ).lean();
    return row?.exercice ? String(row.exercice) : null;
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    }

    const userId = process.argv[2] || DEFAULT_USER_ID;
    await mongoose.connect(mongoUrl + database);

    const exerciceId = await findExerciceIdForVariation(userId, HUMAN_FLAG_TUCK_EX_ID);
    console.log('\n=== Contexte ===');
    console.log({ userId, exerciceId, humanFlagTuckExId: HUMAN_FLAG_TUCK_EX_ID, genericTuckDetailId: GENERIC_TUCK_DETAIL_ID });

    // Chemin WORKOUT : getPRs avec variations = exercice seul (comme normalizeVariationIdsFromVariations)
    console.log('\n=== WORKOUT PATH: getPRs(variations=[exerciseId]) ===');
    const workoutPrs = await setLib.getPRs(userId, null, null, null, null, [HUMAN_FLAG_TUCK_EX_ID], undefined);
    console.log('ATH repetitions:', pickAth(workoutPrs));

    // Variante workout avec exerciceId passé (si le client l'envoie un jour)
    const workoutPrsWithExercice = await setLib.getPRs(
        userId, null, exerciceId, null, null, [HUMAN_FLAG_TUCK_EX_ID], undefined,
    );
    console.log('ATH avec exerciceId:', pickAth(workoutPrsWithExercice));

    // Groupes de variations utilisés par getPRs (workout) — équivalentTo du Tuck Human Flag
    const DRAPEAU_EX_ID = '669ced7e665a3ffe77714388';
    const workoutVariationGroups = [
        [HUMAN_FLAG_TUCK_EX_ID],
        [DRAPEAU_EX_ID, GENERIC_TUCK_DETAIL_ID],
    ];
    console.log('\n=== Groupes de match getPRs (workout) ===');
    console.log(workoutVariationGroups);

    // Chemin PROFILE : params réels (familyAnchorId = equivalentTo[0], reference = exercice sélectionné)
    console.log('\n=== PROFILE PATH: getProgressionPRs (params app) ===');
    const profilePayload = await setLib.getProgressionPRs({
        userId,
        excludedSeanceId: null,
        exercice: exerciceId,
        categories: null,
        dateMin: null,
        unilateralSide: undefined,
        referenceVariations: [HUMAN_FLAG_TUCK_EX_ID],
        mainExerciseId: DRAPEAU_EX_ID,
        includeAllGraphTargets: true,
        maxTargets: 40,
    });

    console.log('meta.familyScopeDebug:', profilePayload?.meta?.familyScopeDebug ?? null);
    for (const entry of profilePayload?.entries || []) {
        const name = entry?.name?.fr || entry?.name?.en || entry?.variationSignature;
        console.log(`\n--- entry: ${name} ---`);
        console.log({
            variationId: entry.variationId,
            variationSignature: entry.variationSignature,
            isDirect: entry.isDirect,
            strengthPeakReferenceKg: entry.strengthPeak?.referenceKg ?? null,
            strengthPeakSourceValue: entry.strengthPeak?.source?.value ?? null,
            ATH: pickAth(entry.prs),
        });
    }

    // Detailed PRs pour la table détaillée profile (4RM etc.)
    console.log('\n=== PROFILE PATH: getProgressionDetailedPRs (table détaillée) ===');
    const detailedPayload = await setLib.getProgressionDetailedPRs({
        userId,
        exercice: exerciceId,
        categories: null,
        dateMin: null,
        unilateralSide: undefined,
        referenceVariations: [HUMAN_FLAG_TUCK_EX_ID],
        mainExerciseId: DRAPEAU_EX_ID,
        includeAllGraphTargets: true,
        maxTargets: 40,
    });

    const directDetailed = (detailedPayload?.entries || []).find((e) => e.isDirect)
        || (detailedPayload?.entries || []).find((e) => String(e.variationId) === String(HUMAN_FLAG_TUCK_EX_ID))
        || (detailedPayload?.entries || [])[0];

    if (directDetailed) {
        const name = directDetailed?.name?.fr || directDetailed?.name?.en || directDetailed?.variationSignature;
        console.log(`\nEntrée ciblée: ${name}`);
        for (const rmKey of ['ATH', '4RM', '3RM', '2RM', '1RM', 'Last']) {
            const slot = directDetailed.prs?.[rmKey]?.repetitions;
            if (!slot) continue;
            console.log(`  ${rmKey}:`, {
                setId: slot._id != null ? String(slot._id) : null,
                value: slot.value,
                weightLoad: slot.weightLoad,
                normalizedOneRm: slot.normalizedOneRm,
                oneRmKg: resolvePrComparisonOneRmKg(slot),
            });
        }
    }

    // Tous les sets matchés par le workout (union des 2 groupes)
    console.log('\n=== Sets matchés par workout getPRs (2 signatures) ===');
    const workoutMatchedSets = await Set.find({
        user: new mongoose.Types.ObjectId(userId),
        value: { $gt: 0 },
        $or: workoutVariationGroups.map((group) => ({
            variations: {
                $size: group.length,
                $all: group.map((id) => ({ $elemMatch: { variation: new mongoose.Types.ObjectId(id) } })),
            },
        })),
    }).sort({ date: 1 }).lean();
    console.log('count:', workoutMatchedSets.length);
    for (const s of workoutMatchedSets) {
        const vars = (s.variations || []).map((v) => String(v?.variation));
        const oneRm = resolvePrComparisonOneRmKg(s);
        console.log({
            setId: String(s._id),
            value: s.value,
            weightLoad: s.weightLoad,
            date: s.date,
            variations: vars,
            brzyckiBw: s.brzyckiWithBodyweight ?? s.brzycki_with_bodyweight,
            epleyBw: s.epleyWithBodyweight ?? s.epley_with_bodyweight,
            oneRmKg: oneRm,
            isAthWinner: String(s._id) === String(workoutPrs?.ATH?.repetitions?._id),
        });
    }

    // Sets bruts pour le drapeau tuck
    console.log('\n=== Sets bruts (exact match exercise id seul) ===');
    const rawSets = await Set.find({
        user: new mongoose.Types.ObjectId(userId),
        value: { $gt: 0 },
        'variations.variation': new mongoose.Types.ObjectId(HUMAN_FLAG_TUCK_EX_ID),
    }).sort({ date: 1 }).lean();
    console.log('count:', rawSets.length);
    for (const s of rawSets) {
        console.log({
            setId: String(s._id),
            value: s.value,
            weightLoad: s.weightLoad,
            date: s.date,
            seanceId: s.seance != null ? String(s.seance) : null,
            variations: (s.variations || []).map((v) => String(v?.variation)),
            unilateralSide: s.unilateralSide ?? null,
        });
    }

    // Simule workout avec exclusion de la séance du set 4 reps le plus récent
    const latestFourRep = rawSets.filter((s) => s.value === 4).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (latestFourRep?.seance) {
        console.log('\n=== WORKOUT PATH avec excludedSeanceId (séance du 4 reps récent) ===');
        const excluded = String(latestFourRep.seance);
        const prsExcluded = await setLib.getPRs(userId, excluded, null, null, null, [HUMAN_FLAG_TUCK_EX_ID], undefined);
        console.log('excludedSeanceId:', excluded);
        console.log('ATH:', pickAth(prsExcluded));
    }

    // Profile avec référence tuck générique (comme timeseries debug logs)
    console.log('\n=== PROFILE PATH: referenceVariations=[tuck générique] ===');
    const profileTuckRef = await setLib.getProgressionPRs({
        userId,
        referenceVariations: [GENERIC_TUCK_DETAIL_ID],
        mainExerciseId: HUMAN_FLAG_TUCK_EX_ID,
        includeAllGraphTargets: true,
        maxTargets: 40,
        lateralMode: 'left',
    });
    for (const entry of profileTuckRef?.entries || []) {
        const name = entry?.name?.fr || entry?.name?.en || entry?.variationSignature;
        const ath = pickAth(entry.prs);
        if (!ath) continue;
        console.log({ name, signature: entry.variationSignature, ATH: ath });
    }
}

run()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
