/**
 * Audit des programmes « présents mais vides » (suggestions + dossiers).
 *
 * Reproduit la logique frontend :
 *   - ProgramQuickStartModal (preview exercices)
 *   - startFromProgramTemplate / startFromLastSeance
 *   - suggestions (computeProgramSuggestions)
 *
 * Usage :
 *   node oneShotQueries/auditEmptyPrograms.js
 *   node oneShotQueries/auditEmptyPrograms.js --userId=<mongoId>
 *   node oneShotQueries/auditEmptyPrograms.js --userId=... --verbose
 *   node oneShotQueries/auditEmptyPrograms.js --userId=... --only-broken
 */
require('dotenv').config();

const mongoose = require('mongoose');
const UserProgram = require('../schema/userProgram');
const Seance = require('../schema/seance');
const Seanceset = require('../schema/seanceset');
const Variation = require('../schema/variation');
const { computeProgramSuggestions } = require('../lib/programSuggestions');
const {
    ISSUE,
    classifyProgram,
    summarizeIssues,
    toId,
} = require('../lib/emptyProgramAudit');

function parseArg(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((arg) => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

async function attachSeanceCounts(programs) {
    if (!programs.length) return programs;

    const ids = programs.map((p) => p._id);
    const stats = await Seance.aggregate([
        { $match: { program: { $in: ids } } },
        {
            $group: {
                _id: '$program',
                count: { $sum: 1 },
                lastSeanceDate: { $max: '$date' },
            },
        },
    ]);
    const statsMap = new Map(stats.map((row) => [toId(row._id), row]));

    return programs.map((program) => {
        const stat = statsMap.get(toId(program._id));
        return {
            ...program,
            seanceCount: stat?.count || 0,
            lastSeanceDate: stat?.lastSeanceDate || null,
        };
    });
}

async function buildVariationExistsMap(programs) {
    const allIds = new Set();
    for (const program of programs) {
        const template = Array.isArray(program.program) ? program.program : [];
        for (const entry of template) {
            for (const id of entry?.variationIds || []) {
                allIds.add(toId(id));
            }
        }
    }

    if (allIds.size === 0) return new Map();

    const objectIds = [...allIds]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    const variations = await Variation.find({ _id: { $in: objectIds } }, { _id: 1 }).lean();
    const map = new Map();
    for (const id of allIds) {
        map.set(id, false);
    }
    for (const variation of variations) {
        map.set(toId(variation._id), true);
    }
    return map;
}

async function resolveLastSeanceContext(program) {
    let lastSeanceId = program.lastSeanceId || null;
    let lastSeance = null;

    if (lastSeanceId) {
        lastSeance = await Seance.findById(lastSeanceId).select('_id date').lean();
    }

    if (!lastSeance) {
        lastSeance = await Seance.findOne({ program: program._id, user: program.user })
            .sort({ date: -1 })
            .select('_id date')
            .lean();
        lastSeanceId = lastSeance?._id || null;
    }

    let lastSeanceSetCount = 0;
    if (lastSeance?._id) {
        lastSeanceSetCount = await Seanceset.countDocuments({ seance: lastSeance._id });
    }

    return {
        lastSeanceId,
        lastSeanceExists: Boolean(lastSeance),
        lastSeanceSetCount,
        staleLastSeanceId: Boolean(program.lastSeanceId && !lastSeance),
    };
}

async function auditProgram(program, variationExistsById) {
    const seanceCount = program.seanceCount || 0;
    const lastSeanceCtx = await resolveLastSeanceContext(program);

    const enrichedProgram = {
        ...program,
        lastSeanceId: lastSeanceCtx.lastSeanceId,
    };

    const classification = classifyProgram(enrichedProgram, {
        seanceCount,
        variationExistsById,
        lastSeanceExists: lastSeanceCtx.lastSeanceExists,
        lastSeanceSetCount: lastSeanceCtx.lastSeanceSetCount,
    });

    const isBroken = classification.quickStart.userPerceivesAsBroken
        || classification.issues.includes(ISSUE.EMPTY_TEMPLATE_WITH_SEANCES)
        || classification.issues.includes(ISSUE.TEMPLATE_UNRESOLVABLE);

    return {
        programId: toId(program._id),
        name: program.name,
        folderId: toId(program.folder),
        seanceCount,
        templateCount: classification.quickStart.templateEntryCount,
        visibleRows: classification.quickStart.visibleExerciseRowCount,
        issues: classification.issues.filter((i) => i !== ISSUE.HEALTHY),
        quickStart: classification.quickStart,
        lastSeanceSetCount: lastSeanceCtx.lastSeanceSetCount,
        staleLastSeanceId: lastSeanceCtx.staleLastSeanceId,
        isBroken,
    };
}

function printProgramAudit(row, verbose) {
    console.log('\n' + '─'.repeat(72));
    console.log(`Programme: ${row.name} (${row.programId})`);
    if (row.folderId) console.log(`  Dossier: ${row.folderId}`);
    console.log(`  Séances liées: ${row.seanceCount}`);
    console.log(`  Template: ${row.templateCount} entrée(s), ${row.visibleRows} visible(s) dans la modale`);
    console.log(`  Dernière séance — sets: ${row.lastSeanceSetCount}${row.staleLastSeanceId ? ' (lastSeanceId stale)' : ''}`);
    console.log(`  Issues: ${row.issues.length ? row.issues.join(', ') : 'aucune'}`);
    console.log(`  UI perçue comme cassée ? ${row.isBroken ? 'OUI ✗' : 'non'}`);

    if (verbose) {
        console.log('  Détail quickStart:', JSON.stringify(row.quickStart, null, 2));
    }
}

async function auditUser(userId, { verbose, onlyBroken }) {
    const programs = await UserProgram.find({ user: userId, isArchived: false }).lean();
    const withCounts = await attachSeanceCounts(programs);
    const variationExistsById = await buildVariationExistsMap(withCounts);

    const audits = [];
    for (const program of withCounts) {
        const row = await auditProgram(program, variationExistsById);
        if (!onlyBroken || row.isBroken) {
            audits.push(row);
        }
    }

    const suggestions = await computeProgramSuggestions(userId);
    const suggestionIds = new Set((suggestions.suggestions || []).map((s) => toId(s.programId)));

    const broken = audits.filter((row) => row.isBroken);
    const brokenInSuggestions = broken.filter((row) => suggestionIds.has(row.programId));

    console.log('\n' + '='.repeat(72));
    console.log(`AUDIT programmes vides — user ${userId}`);
    console.log('='.repeat(72));
    console.log(`Programmes actifs: ${withCounts.length}`);
    console.log(`Programmes problématiques: ${broken.length}`);
    console.log(`  dont visibles en suggestions: ${brokenInSuggestions.length}`);
    console.log('\nRépartition des issues:');
    console.log(summarizeIssues(audits.map((row) => ({ issues: row.issues.length ? row.issues : [ISSUE.HEALTHY] }))));

    if (suggestions.suggestions?.length) {
        console.log('\nSuggestions actuelles:');
        for (const item of suggestions.suggestions) {
            const audit = audits.find((row) => row.programId === toId(item.programId));
            const status = audit?.isBroken ? '⚠️  CASSÉ' : 'ok';
            console.log(`  - [${item.type}] ${item.name} (${item.programId}) — ${status}`);
        }
    }

    const rowsToPrint = onlyBroken ? broken : audits.filter((row) => row.isBroken || verbose);
    for (const row of rowsToPrint) {
        printProgramAudit(row, verbose);
    }

    if (!rowsToPrint.length && onlyBroken) {
        console.log('\nAucun programme problématique pour cet utilisateur.');
    }

    return { audits, broken, brokenInSuggestions, suggestions: suggestions.suggestions || [] };
}

async function auditGlobal({ verbose, onlyBroken, limit = 20 }) {
    const pipeline = [
        { $match: { isArchived: false } },
        {
            $lookup: {
                from: 'seances',
                localField: '_id',
                foreignField: 'program',
                as: 'linkedSeances',
            },
        },
        {
            $addFields: {
                seanceCount: { $size: '$linkedSeances' },
                templateCount: { $size: { $ifNull: ['$program', []] } },
            },
        },
        {
            $match: {
                seanceCount: { $gt: 0 },
                templateCount: 0,
            },
        },
        { $sort: { seanceCount: -1 } },
        { $limit: limit },
        { $project: { name: 1, user: 1, seanceCount: 1, lastSeanceId: 1 } },
    ];

    const emptyTemplateWithHistory = await UserProgram.aggregate(pipeline);

    console.log('\n' + '='.repeat(72));
    console.log('AUDIT GLOBAL — template vide mais séances liées (top cas)');
    console.log('='.repeat(72));
    console.log(`Cas trouvés (limite ${limit}): ${emptyTemplateWithHistory.length}`);

    for (const row of emptyTemplateWithHistory) {
        console.log(`  - ${row.name} | user=${row.user} | séances=${row.seanceCount} | lastSeanceId=${row.lastSeanceId || '—'}`);
    }

    if (!verbose) {
        console.log('\nAstuce: --userId=<id> pour un audit détaillé par utilisateur.');
    }
}

async function main() {
    const userId = parseArg('userId');
    const verbose = hasFlag('verbose');
    const onlyBroken = hasFlag('only-broken');

    if (!process.env.mongoURL || !process.env.DATABASE) {
        console.error('Variables mongoURL / DATABASE manquantes (.env)');
        process.exit(1);
    }

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    console.log('Connecté à', process.env.DATABASE);

    try {
        if (userId) {
            await auditUser(userId, { verbose, onlyBroken });
        } else {
            await auditGlobal({ verbose, onlyBroken });
        }
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = {
    auditUser,
    auditProgram,
    attachSeanceCounts,
};
