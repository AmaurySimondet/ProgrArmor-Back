/**
 * Pour un utilisateur et un exercice (variation isExercice=true), liste les variations
 * isExercice=false les plus présentes en slots > 0 sur les séries où l’exo principal est [0]
 * et que cet exo est soit la variation de base, soit un exercice dont equivalentTo contient la base.
 *
 * Exemple : user + Squat → inclut les séries dont [0] est la base ou un doc avec Squat dans equivalentTo
 * (même si isExercice du doc lié est false en base — ex. variante mal typée).
 *
 * Sortie :
 * 1) Répartition des exos en [0] parmi les IDs liés (Squat Zercher apparaît ici si loggé en principal).
 * 2) Détails isExercice=false les plus fréquents en slots > 0 uniquement.
 *
 * Usage:
 *   node oneShotQueries/inspectUserDetailsForExercise.js [userId] [exerciseId24OrName] [topN]
 *
 * Si exerciseId24OrName est omis, défaut : nom "Squat" (premier match isExercice=true).
 */
const mongoose = require('mongoose');
require('dotenv').config();

const SeanceSet = require('../schema/seanceset');
const Variation = require('../schema/variation');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';
const DEFAULT_EXERCISE_NAME = 'Squat';
const DEFAULT_TOP = 40;

function isObjectIdString(s) {
    return typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
}

async function resolveExerciseVariation(exerciseArg) {
    if (!exerciseArg) {
        const doc = await Variation.findOne(
            { isExercice: true, 'name.fr': new RegExp(`^${DEFAULT_EXERCISE_NAME}$`, 'i') },
            { name: 1, isExercice: 1 }
        ).lean();
        return doc;
    }
    if (isObjectIdString(exerciseArg)) {
        const doc = await Variation.findOne(
            { _id: new mongoose.Types.ObjectId(exerciseArg), isExercice: true },
            { name: 1, isExercice: 1 }
        ).lean();
        return doc;
    }
    const doc = await Variation.findOne(
        { isExercice: true, 'name.fr': new RegExp(`^${exerciseArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        { name: 1, isExercice: 1 }
    ).lean();
    return doc;
}

/**
 * IDs en [0] à inclure : la base (doit être un exercice) + tout document Variation dont equivalentTo contient la base.
 * Le second groupe n’est pas filtré par isExercice : sinon une variante type exo mais isExercice=false serait omise.
 */
async function loadPrimaryExerciseIdsLinkedToBase(baseOid) {
    const baseDoc = await Variation.findOne(
        { _id: baseOid, isExercice: true },
        { name: 1, isExercice: 1 }
    ).lean();
    if (!baseDoc) {
        return { ids: [], docs: [] };
    }

    const linkedDocs = await Variation.find({ equivalentTo: baseOid }, { name: 1, isExercice: 1 }).lean();

    const seen = new Map();
    seen.set(baseDoc._id.toString(), baseDoc);
    for (const d of linkedDocs) {
        seen.set(d._id.toString(), d);
    }
    const docs = [...seen.values()];
    const ids = docs.map((d) => d._id);
    return { ids, docs };
}

async function main() {
    const userId = process.argv[2] || DEFAULT_USER_ID;
    const exerciseArg = process.argv[3];
    const topN = Math.max(1, parseInt(process.argv[4], 10) || DEFAULT_TOP);

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    try {
        const exercise = await resolveExerciseVariation(exerciseArg);
        if (!exercise) {
            console.error(
                'Exercice introuvable (isExercice=true). Passe un ObjectId 24 chars ou un nom exact (ex. Squat).'
            );
            process.exitCode = 1;
            return;
        }

        const userOid = new mongoose.Types.ObjectId(userId);
        const exOid = exercise._id;
        const exOidStr = exOid.toString();

        const { ids: primaryLinkedIds, docs: primaryLinkedDocs } =
            await loadPrimaryExerciseIdsLinkedToBase(exOid);

        if (primaryLinkedIds.length === 0) {
            console.error('Aucun exercice candidat (base + equivalentTo).');
            process.exitCode = 1;
            return;
        }

        const primaryRows = await SeanceSet.aggregate([
            {
                $match: {
                    user: userOid,
                    'variations.0': { $exists: true },
                    $expr: {
                        $in: [{ $arrayElemAt: ['$variations.variation', 0] }, primaryLinkedIds]
                    }
                }
            },
            {
                $group: {
                    _id: { $arrayElemAt: ['$variations.variation', 0] },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: topN }
        ]);

        const rows = await SeanceSet.aggregate([
            {
                $match: {
                    user: userOid,
                    'variations.0': { $exists: true },
                    'variations.1': { $exists: true },
                    $expr: {
                        $in: [{ $arrayElemAt: ['$variations.variation', 0] }, primaryLinkedIds]
                    }
                }
            },
            {
                $unwind: {
                    path: '$variations',
                    includeArrayIndex: '_slot'
                }
            },
            { $match: { _slot: { $gt: 0 } } },
            {
                $group: {
                    _id: '$variations.variation',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: topN * 3 }
        ]);

        const linkedLabels = primaryLinkedDocs
            .map(
                (d) =>
                    `${d.name?.fr || d._id}${d._id.toString() === exOidStr ? ' (base)' : ''}`
            )
            .join(', ');

        if (primaryRows.length === 0 && rows.length === 0) {
            console.log(`User ${userId}`);
            console.log(
                `Variation de base : ${exercise.name?.fr || exercise._id} (${exercise._id})`
            );
            console.log(
                `Variations liées (base + equivalentTo⊃base) : ${primaryLinkedDocs.length} — ${linkedLabels}`
            );
            console.log('Aucune série pour ce user avec un de ces IDs en [0].');
            return;
        }

        const primaryNameIds = primaryRows.map((r) => r._id);
        const primaryNameDocs = await Variation.find(
            { _id: { $in: primaryNameIds } },
            { name: 1, isExercice: 1 }
        ).lean();
        const primaryNameById = new Map(
            primaryNameDocs.map((d) => [d._id.toString(), d.name?.fr || d.name?.en || ''])
        );

        const ids = rows.map((r) => r._id);
        const detailDocs = await Variation.find(
            { _id: { $in: ids }, isExercice: false },
            { name: 1, type: 1, isExercice: 1 }
        ).lean();

        const detailSet = new Set(detailDocs.map((d) => d._id.toString()));
        const nameById = new Map(detailDocs.map((d) => [d._id.toString(), d.name?.fr || d.name?.en || '']));

        const filtered = rows
            .filter((r) => detailSet.has(r._id.toString()))
            .slice(0, topN);

        const withAnyLinkedPrimary = primaryRows.reduce((s, r) => s + r.count, 0);

        console.log(`User ${userId}`);
        console.log(
            `Variation de base : ${exercise.name?.fr || exercise._id} (${exercise._id})`
        );
        console.log(
            `Variations liées (base + equivalentTo⊃base) : ${primaryLinkedDocs.length} — ${linkedLabels}`
        );
        console.log(`Lignes de séries avec un de ces IDs en [0] : ${withAnyLinkedPrimary}`);

        console.log(`\n--- Exercice / variation en slot [0] (top ${topN}, toutes isExercice) ---`);
        primaryRows.forEach((r, i) => {
            const id = r._id.toString();
            const label = primaryNameById.get(id) || id;
            const tag = id === exOidStr ? ' (base)' : '';
            console.log(`${String(i + 1).padStart(3)}. ${String(r.count).padStart(4)}×  ${label}${tag}`);
        });

        console.log(
            `\n--- Détails isExercice=false (slots 1..n uniquement, top ${topN}) ---`
        );
        if (filtered.length === 0) {
            console.log('(Aucun détail ou combos à un seul slot — normal si tu ne stack pas de détails.)');
        } else {
            filtered.forEach((r, i) => {
                const id = r._id.toString();
                const label = nameById.get(id) || id;
                console.log(`${String(i + 1).padStart(3)}. ${String(r.count).padStart(4)}×  ${label}`);
            });
        }

        const skipped = rows.filter((r) => !detailSet.has(r._id.toString())).length;
        if (skipped > 0) {
            console.log(
                `\n(${skipped} entrées parmi les candidats détails étaient isExercice≠false — non listées.)`
            );
        }
    } finally {
        await mongoose.connection.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
