/**
 * Diagnostic badges PR : compare recordSummary persisté vs re-évaluation isPr.
 *
 * Usage:
 *   node oneShotQueries/debugSeanceRecordSummaryDrift.js [seanceId]
 *
 * Compare deux modes de re-évaluation :
 * - baseline : seance exclue, historique complet (comportement actuel edit)
 * - timeCapsule : seance exclue + sets.date < seance.date + poids corps à seance.date
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');
const Seance = require('../schema/seance');
const SeanceSet = require('../schema/seanceset');

const SEANCE_ID = process.argv[2] || '6a4657c0f5ef1e8662a9f856';
const QUIET_PR_LOGS = process.env.DEBUG_PR_ISPR === '0' || process.env.DEBUG_PR_ISPR === 'false';

function countPrFromSets(sets) {
    const map = new Map();
    for (const set of sets) {
        if (!set?.PR) continue;
        map.set(set.PR, (map.get(set.PR) || 0) + 1);
    }
    return Array.from(map.entries()).map(([PR, number]) => ({ PR, number }));
}

function formatSummary(summary) {
    if (!Array.isArray(summary) || summary.length === 0) return '(vide)';
    return summary
        .slice()
        .sort((a, b) => String(a.PR).localeCompare(String(b.PR)))
        .map(({ PR, number }) => `${PR} x ${number}`)
        .join(', ');
}

function groupSetsByExercise(sets) {
    const groups = new Map();
    for (const set of sets) {
        const key = `${set.exerciceOrder ?? '?'}|${(set.variations || []).map((v) => String(v.variation)).sort().join('-')}`;
        if (!groups.has(key)) {
            groups.set(key, {
                exerciceOrder: set.exerciceOrder,
                variations: set.variations,
                sets: [],
            });
        }
        groups.get(key).sets.push(set);
    }
    for (const group of groups.values()) {
        group.sets.sort((a, b) => (a.setOrder ?? 0) - (b.setOrder ?? 0));
    }
    return [...groups.values()].sort((a, b) => (a.exerciceOrder ?? 0) - (b.exerciceOrder ?? 0));
}

function buildSessionSetsForEval(allSets, { excludeSetId, unit, isUnilateral, unilateralSide }) {
    const excludeId = excludeSetId != null ? String(excludeSetId) : null;
    return allSets
        .filter((set) => {
            if (!set || (excludeId && String(set._id) === excludeId)) return false;
            const value = Number(set.value);
            if (!Number.isFinite(value) || value < 0) return false;
            if (unit && set.unit !== unit) return false;
            if (isUnilateral === true && (unilateralSide === 'left' || unilateralSide === 'right')) {
                return set.isUnilateral === true && set.unilateralSide === unilateralSide;
            }
            return true;
        })
        .map((set) => ({
            _id: set._id,
            unit: set.unit,
            value: set.value,
            weightLoad: set.weightLoad,
            elastic: set.elastic ?? null,
            effectiveWeightLoad: set.effectiveWeightLoad,
            isUnilateral: set.isUnilateral === true,
            unilateralSide: set.unilateralSide,
            brzycki: set.brzycki,
            epley: set.epley,
            normalizedOneRm: set.normalizedOneRm,
        }));
}

async function reevaluateSeanceSets({
    sets,
    exercises,
    userId,
    seanceId,
    prEvaluationOptions = undefined,
    label,
}) {
    const driftRows = [];
    const resultsBySetId = new Map();

    for (const exercise of exercises) {
        for (const set of exercise.sets) {
            const value = Number(set.value);
            if (!Number.isFinite(value) || value < 0) continue;

            const isUnilateralSet = set.isUnilateral === true;
            const unilateralSide = isUnilateralSet
                && (set.unilateralSide === 'left' || set.unilateralSide === 'right')
                ? set.unilateralSide
                : undefined;
            const sessionSets = buildSessionSetsForEval(exercise.sets, {
                excludeSetId: set._id,
                unit: set.unit,
                isUnilateral: isUnilateralSet,
                unilateralSide,
            });

            const { isPersonalRecord, prDetail } = await setLib.isPersonalRecordWithDetail(
                userId,
                seanceId,
                set.unit,
                set.value,
                set.weightLoad,
                set.elastic ?? null,
                set.variations,
                set.effectiveWeightLoad,
                isUnilateralSet ? true : undefined,
                unilateralSide,
                sessionSets,
                set._id,
                set.cardio ?? undefined,
                prEvaluationOptions,
            );

            const storedPr = set.PR ?? null;
            const recomputedPr = isPersonalRecord ?? null;
            resultsBySetId.set(String(set._id), recomputedPr);

            if (storedPr !== recomputedPr) {
                driftRows.push({
                    setId: String(set._id),
                    exerciceOrder: set.exerciceOrder,
                    setOrder: set.setOrder,
                    unit: set.unit,
                    value: set.value,
                    weightLoad: set.weightLoad,
                    effectiveWeightLoad: set.effectiveWeightLoad,
                    storedPr,
                    recomputedPr,
                    reason: prDetail?.statusReason ?? null,
                });
            }
        }
    }

    const summaryRecomputed = countPrFromSets(
        sets.map((set) => ({
            ...set,
            PR: resultsBySetId.has(String(set._id))
                ? resultsBySetId.get(String(set._id))
                : set.PR,
        })),
    );

    return { label, driftRows, summaryRecomputed };
}

function printDriftReport({ label, driftRows, summaryRecomputed, totalSets }) {
    console.log(`--- ${label} ---`);
    console.log('Summary après re-évaluation:  ', formatSummary(summaryRecomputed));

    if (driftRows.length === 0) {
        console.log('Aucun drift storedPr vs recomputedPr.\n');
        return;
    }

    console.log(`Drifts détectés: ${driftRows.length}/${totalSets} sets`);
    console.table(driftRows.slice(0, 20));
    if (driftRows.length > 20) {
        console.log(`... +${driftRows.length - 20} autres`);
    }

    const byTransition = new Map();
    for (const row of driftRows) {
        const key = `${row.storedPr ?? 'null'} → ${row.recomputedPr ?? 'null'}`;
        byTransition.set(key, (byTransition.get(key) || 0) + 1);
    }
    console.log('Transitions:');
    for (const [key, count] of [...byTransition.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${key}: ${count}`);
    }
    console.log('');
}

async function main() {
    if (QUIET_PR_LOGS) {
        process.env.DEBUG_PR_ISPR = '0';
    }

    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    console.log(`Connected. Seance: ${SEANCE_ID}\n`);

    const seance = await Seance.findById(SEANCE_ID).lean();
    if (!seance) {
        throw new Error(`Seance ${SEANCE_ID} not found`);
    }

    const sets = await SeanceSet.find({ seance: SEANCE_ID })
        .sort({ exerciceOrder: 1, setOrder: 1 })
        .lean();

    const summaryFromSets = countPrFromSets(sets);
    const summaryStored = seance.recordSummary || [];
    const seanceReferenceDate = seance.date ? new Date(seance.date) : null;

    console.log('=== recordSummary ===');
    console.log('Persisté (seance.recordSummary):', formatSummary(summaryStored));
    console.log('Recalculé depuis sets.PR:     ', formatSummary(summaryFromSets));
    console.log('Seance date:                  ', seanceReferenceDate?.toISOString?.() ?? '(absente)');
    console.log('');

    const exercises = groupSetsByExercise(sets);
    const userId = String(seance.user);

    const baseline = await reevaluateSeanceSets({
        sets,
        exercises,
        userId,
        seanceId: SEANCE_ID,
        prEvaluationOptions: undefined,
        label: 'baseline',
    });

    const timeCapsule = await reevaluateSeanceSets({
        sets,
        exercises,
        userId,
        seanceId: SEANCE_ID,
        prEvaluationOptions: seanceReferenceDate
            ? {
                historicalBeforeDate: seanceReferenceDate,
                referenceDate: seanceReferenceDate,
            }
            : undefined,
        label: 'timeCapsule',
    });

    console.log('=== Re-évaluation isPr ===');
    printDriftReport({ ...baseline, totalSets: sets.length });
    printDriftReport({ ...timeCapsule, totalSets: sets.length });

    console.log('=== Comparaison rapide ===');
    console.log('Baseline:    ', formatSummary(baseline.summaryRecomputed));
    console.log('Time capsule:', formatSummary(timeCapsule.summaryRecomputed));
    console.log('Persisté:    ', formatSummary(summaryStored));
    console.log(`Drifts baseline: ${baseline.driftRows.length}, time capsule: ${timeCapsule.driftRows.length}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
