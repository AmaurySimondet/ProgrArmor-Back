/**
 * Compare la cartographie musculaire séance vs profil pour diagnostiquer les incohérences.
 *
 * Usage:
 *   node oneShotQueries/compareSessionVsProfileMuscleRecency.js <userId> [--seanceId=...] [--date=YYYY-MM-DD]
 *
 * Exemples:
 *   node oneShotQueries/compareSessionVsProfileMuscleRecency.js 6365489f44d4b4000470882b --date=2026-07-07
 *   node oneShotQueries/compareSessionVsProfileMuscleRecency.js 6365489f44d4b4000470882b --seanceId=...
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Seance = require('../schema/seance');
const SeanceSet = require('../schema/seanceset');
const Variation = require('../schema/variation');
const { computeUserMuscleRecency } = require('../lib/userMuscleRecency');
const {
    buildReverseEquivalentMuscleMap,
    buildSeanceMuscleComparisonReport,
    findMusclesAttributedToSeance,
} = require('../lib/userMuscleRecencyDebug');

function parseArgs(argv) {
    const userId = argv[2];
    const options = { seanceId: null, date: null };
    for (const arg of argv.slice(3)) {
        if (arg.startsWith('--seanceId=')) options.seanceId = arg.slice('--seanceId='.length);
        if (arg.startsWith('--date=')) options.date = arg.slice('--date='.length);
    }
    return { userId, options };
}

function formatMuscleList(muscles = []) {
    return muscles.length ? muscles.join(', ') : '(aucun)';
}

function printReport(report) {
    console.log('\n========================================');
    console.log(`Séance: ${report.seanceTitle || report.seanceId}`);
    console.log(`Date: ${report.seanceDate}`);
    console.log(`Sets: ${report.setCount}`);
    console.log('========================================');

    console.log('\n--- Vue SÉANCE (exercice principal uniquement) ---');
    console.log('Primaires :', formatMuscleList(report.sessionStyle.primary));
    console.log('Secondaires :', formatMuscleList(report.sessionStyle.secondary));

    console.log('\n--- Vue PROFIL (exercice principal par set, comme le backend) ---');
    console.log('Muscles :', formatMuscleList(report.profileStyle.muscles));

    console.log('\n--- API userMuscleRecency (muscles avec lastSeanceId = cette séance) ---');
    console.log(`Count: ${report.apiAttributed.count}`);
    console.log('Muscles :', formatMuscleList(report.apiAttributed.muscles.map((m) => m.muscleKey)));

    const { sessionVsProfile, profileOnlyExplanations } = report.comparison;
    console.log('\n--- ÉCART session → profil ---');
    console.log(`Partagés (${sessionVsProfile.shared.length}) :`, formatMuscleList(sessionVsProfile.shared));
    console.log(`Uniquement en profil (${sessionVsProfile.onlyInProfile.length}) :`, formatMuscleList(sessionVsProfile.onlyInProfile));
    console.log(`Uniquement en séance (${sessionVsProfile.onlyInSession.length}) :`, formatMuscleList(sessionVsProfile.onlyInSession));

    if (sessionVsProfile.onlyInProfile.length > 0) {
        console.log('\n--- Détail des muscles UNIQUEMENT en profil ---');
        for (const muscleKey of sessionVsProfile.onlyInProfile) {
            const sources = profileOnlyExplanations[muscleKey] || [];
            console.log(`\n▸ ${muscleKey} (${sources.length} source(s))`);
            for (const source of sources.slice(0, 5)) {
                console.log(`  set #${source.setOrder} | ${source.mergedName || source.variationName}`);
                console.log(`    variation: ${source.variationName} (${source.variationId})`);
                console.log(`    isExercice=${source.isExercice} source=${source.source}`);
                if (source.muscles) {
                    console.log(`    tags: primary=${JSON.stringify(source.muscles.primary || [])} secondary=${JSON.stringify(source.muscles.secondary || [])}`);
                }
            }
            if (sources.length > 5) {
                console.log(`  ... +${sources.length - 5} autre(s) source(s)`);
            }
        }
    }

    console.log('\n--- Exercices de la séance (vue session) ---');
    for (const exercise of report.sessionStyle.exerciseBreakdown) {
        console.log(`\n• ${exercise.mergedName} (${exercise.setCount} sets)`);
        console.log(`  Exercice principal: ${exercise.primaryExercise?.name || '—'} (${exercise.primaryExercise?.id || '—'})`);
        console.log(`  Primaires: ${formatMuscleList(exercise.primaryMuscles)}`);
        console.log(`  Secondaires: ${formatMuscleList(exercise.secondaryMuscles)}`);
        console.log('  Chaîne set.variations:');
        for (const v of exercise.chainVariations) {
            const tags = v.muscles
                ? `primary=${JSON.stringify(v.muscles.primary || [])} secondary=${JSON.stringify(v.muscles.secondary || [])}`
                : 'pas de tags';
            console.log(`    - ${v.name} [isExercice=${v.isExercice}] ${tags}`);
        }
    }
}

async function loadVariationContext(sets) {
    const variationIds = new Set();
    for (const set of sets) {
        for (const entry of set.variations || []) {
            if (entry?.variation) variationIds.add(String(entry.variation));
        }
    }

    const objectIds = [...variationIds].map((id) => new mongoose.Types.ObjectId(id));
    const variations = await Variation.find({ _id: { $in: objectIds } })
        .select('name muscles isExercice equivalentTo')
        .lean();

    const variationById = new Map(
        variations.map((variation) => [String(variation._id), variation]),
    );

    const canonicalWithMuscles = await Variation.find({
        isExercice: true,
        $or: [
            { 'muscles.primary.0': { $exists: true } },
            { 'muscles.secondary.0': { $exists: true } },
        ],
        equivalentTo: { $in: objectIds },
    })
        .select('muscles equivalentTo name')
        .lean();

    const reverseEquivalentMap = buildReverseEquivalentMuscleMap(canonicalWithMuscles);

    return { variationById, reverseEquivalentMap };
}

async function main() {
    const { userId, options } = parseArgs(process.argv);
    if (!userId) {
        console.error('Usage: node oneShotQueries/compareSessionVsProfileMuscleRecency.js <userId> [--seanceId=...] [--date=YYYY-MM-DD]');
        process.exit(1);
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

    const userIdObj = new mongoose.Types.ObjectId(userId);
    const now = new Date();

    console.log('=== Comparaison cartographie musculaire séance vs profil ===');
    console.log('userId:', userId);
    console.log('now:', now.toISOString());

    const muscleRecencyPayload = await computeUserMuscleRecency(userIdObj, now);

    let seances = [];
    if (options.seanceId) {
        const seance = await Seance.findById(options.seanceId).lean();
        if (!seance) throw new Error(`Séance introuvable: ${options.seanceId}`);
        seances = [seance];
    } else if (options.date) {
        const start = new Date(`${options.date}T00:00:00.000Z`);
        const end = new Date(`${options.date}T23:59:59.999Z`);
        seances = await Seance.find({
            user: userIdObj,
            date: { $gte: start, $lte: end },
        }).sort({ date: -1 }).lean();
    } else {
        const recentSets = await SeanceSet.find({ user: userIdObj })
            .sort({ date: -1 })
            .limit(1)
            .select('seance')
            .lean();
        if (recentSets[0]?.seance) {
            const seance = await Seance.findById(recentSets[0].seance).lean();
            if (seance) seances = [seance];
        }
    }

    if (!seances.length) {
        console.log('Aucune séance trouvée. Utilisez --seanceId ou --date=YYYY-MM-DD');
        await mongoose.disconnect();
        return;
    }

    console.log(`\nSéances à analyser: ${seances.length}`);

    for (const seance of seances) {
        const sets = await SeanceSet.find({ seance: seance._id })
            .sort({ setOrder: 1 })
            .lean();

        const { variationById, reverseEquivalentMap } = await loadVariationContext(sets);

        const report = buildSeanceMuscleComparisonReport({
            seanceId: seance._id,
            seanceTitle: seance.title || seance.name,
            seanceDate: seance.date,
            sets,
            variationById,
            reverseEquivalentMap,
            muscleRecencyPayload,
        });

        printReport(report);
    }

    console.log('\n--- Vue globale profil: muscles groupés par lastSeanceId ---');
    const bySeance = new Map();
    for (const [muscleKey, entry] of Object.entries(muscleRecencyPayload.muscles || {})) {
        const sid = entry?.lastSeanceId ? String(entry.lastSeanceId) : '(aucun)';
        if (!bySeance.has(sid)) bySeance.set(sid, []);
        bySeance.get(sid).push({ muscleKey, ...entry });
    }

    const sortedGroups = [...bySeance.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [seanceId, muscles] of sortedGroups.slice(0, 10)) {
        const seanceDoc = seanceId !== '(aucun)'
            ? await Seance.findById(seanceId).select('title name date').lean()
            : null;
        const label = seanceDoc
            ? `${seanceDoc.title || seanceDoc.name} (${new Date(seanceDoc.date).toISOString().slice(0, 10)})`
            : seanceId;
        console.log(`\n${label} → ${muscles.length} muscle(s)`);
        console.log(muscles.map((m) => m.muscleKey).sort().join(', '));
    }

    const suspicious = sortedGroups.filter(([, muscles]) => muscles.length >= 10);
    if (suspicious.length > 0) {
        console.log('\n⚠️  Séances suspectes (≥10 muscles attribués):');
        for (const [seanceId, muscles] of suspicious) {
            const seanceDoc = await Seance.findById(seanceId).select('title name date').lean();
            console.log(`  - ${seanceDoc?.title || seanceId}: ${muscles.length} muscles`);
        }
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
