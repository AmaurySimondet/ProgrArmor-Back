/**
 * Audit / test des 2 sections carousel workout (ajout rapide programme).
 *
 * Reproduit la logique frontend :
 *   - Section 1 : template program[] absent du workout
 *   - Section 2 : historique séances du programme, absent du workout ET absent du template
 *
 * Usage :
 *   node oneShotQueries/auditProgramQuickAddSections.js
 *   node oneShotQueries/auditProgramQuickAddSections.js --userId=6365489f44d4b4000470882b
 *   node oneShotQueries/auditProgramQuickAddSections.js --userId=... --programId=6a1c89d...
 *   node oneShotQueries/auditProgramQuickAddSections.js --userId=... --verbose
 */
require('dotenv').config();

const mongoose = require('mongoose');
const Seance = require('../schema/seance');
const Seanceset = require('../schema/seanceset');
const UserProgram = require('../schema/userProgram');
const { buildProgramTemplateFromSeanceSets } = require('../lib/programTemplate');
const { getProgramPerformedExercises } = require('../lib/programPerformedExercises');

function parseArg(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((arg) => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function buildSignature(entry) {
    const ids = Array.isArray(entry?.variationIds) ? entry.variationIds : [];
    return [...ids].map(String).sort().join('|');
}

function labelForEntry(entry) {
    const fr = entry?.mergedVariationsNames?.fr
        || entry?.variationName?.fr
        || entry?.variationIds?.join(', ');
    return fr || '(sans nom)';
}

function entriesEqual(a, b) {
    const sigA = buildSignature(a);
    const sigB = buildSignature(b);
    return sigA.length > 0 && sigA === sigB;
}

function isEntryInWorkout(entry, workoutEntries) {
    return workoutEntries.some((workoutEntry) => entriesEqual(entry, workoutEntry));
}

function filterTemplateNotInWorkout(template, workoutEntries) {
    return (template || []).filter((entry) => !isEntryInWorkout(entry, workoutEntries));
}

function filterPerformedNotInWorkout(performed, workoutEntries, templateEntries) {
    return (performed || []).filter((entry) => {
        if (isEntryInWorkout(entry, workoutEntries)) return false;
        return !(templateEntries || []).some((templateEntry) => entriesEqual(entry, templateEntry));
    });
}

async function buildWorkoutFromLastSeance(userId, programId) {
    const lastSeance = await Seance.findOne({ user: userId, program: programId })
        .sort({ date: -1 })
        .lean();
    if (!lastSeance) return { workoutEntries: [], lastSeance: null };

    const sets = await Seanceset.find({ seance: lastSeance._id, user: userId }).lean();
    return {
        workoutEntries: buildProgramTemplateFromSeanceSets(sets),
        lastSeance,
    };
}

function computeSections(template, performed, workoutEntries) {
    const section1 = filterTemplateNotInWorkout(template, workoutEntries);
    const section2 = filterPerformedNotInWorkout(performed, workoutEntries, template);
    return { section1, section2 };
}

function printEntries(title, entries) {
    if (!entries.length) {
        console.log(`  ${title}: (vide)`);
        return;
    }
    entries.forEach((entry, index) => {
        const extra = entry.lastPerformedAt
            ? ` — dernière fois ${new Date(entry.lastPerformedAt).toISOString().slice(0, 10)}`
            : '';
        console.log(`    ${index + 1}. ${labelForEntry(entry)} [${buildSignature(entry)}]${extra}`);
    });
}

async function auditProgram(userId, program, verbose) {
    const programId = program._id;
    const template = Array.isArray(program.program) ? program.program : [];
    const performed = await getProgramPerformedExercises(String(userId), String(programId));

    const { workoutEntries, lastSeance } = await buildWorkoutFromLastSeance(userId, programId);
    const fromLast = computeSections(template, performed, workoutEntries);

    const allTemplateSigs = new Set(template.map(buildSignature).filter(Boolean));
    const allPerformedSigs = new Set(performed.map(buildSignature).filter(Boolean));
    const performedOnlySigs = [...allPerformedSigs].filter((sig) => !allTemplateSigs.has(sig));

    let bestPartial = null;
    if (template.length > 1 && workoutEntries.length === 0) {
        for (let keepCount = 1; keepCount < template.length; keepCount += 1) {
            const partialWorkout = template.slice(0, keepCount);
            const partial = computeSections(template, performed, partialWorkout);
            if (partial.section1.length > 0 && partial.section2.length > 0) {
                bestPartial = { keepCount, ...partial };
                break;
            }
        }
    }

    const hasBothFromLast = fromLast.section1.length > 0 && fromLast.section2.length > 0;
    const hasBothPartial = Boolean(bestPartial);

    if (!verbose && !hasBothFromLast && !hasBothPartial && performedOnlySigs.length === 0) {
        return null;
    }

    console.log('\n' + '─'.repeat(72));
    console.log(`Programme: ${program.name} (${programId})`);
    console.log(`  Template: ${template.length} exo(s) | Historique distinct: ${performed.length} exo(s)`);
    console.log(`  Exos historiques hors template: ${performedOnlySigs.length}`);

    if (lastSeance) {
        console.log(`  Dernière séance: ${lastSeance._id} (${new Date(lastSeance.date).toISOString().slice(0, 10)})`);
        console.log(`  Workout simulé = dernière séance (${workoutEntries.length} exo(s))`);
    } else {
        console.log('  Aucune séance liée à ce programme.');
    }

    console.log('\n  ▶ Scénario A — démarrer depuis la dernière séance');
    console.log(`     Section 1 (template): ${fromLast.section1.length}`);
    printEntries('Section 1', fromLast.section1);
    console.log(`     Section 2 (historique hors template): ${fromLast.section2.length}`);
    printEntries('Section 2', fromLast.section2);
    console.log(`     Les 2 sections visibles ? ${hasBothFromLast ? 'OUI ✓' : 'NON'}`);

    if (bestPartial) {
        console.log('\n  ▶ Scénario B — template complet mais workout partiel (simulation)');
        console.log(`     Garder les ${bestPartial.keepCount} premiers exos du template dans le workout`);
        console.log(`     Section 1: ${bestPartial.section1.length}`);
        printEntries('Section 1', bestPartial.section1);
        console.log(`     Section 2: ${bestPartial.section2.length}`);
        printEntries('Section 2', bestPartial.section2);
        console.log('     Les 2 sections visibles ? OUI ✓ (si tu retires des exos ou démarres partiellement)');
    }

    if (performedOnlySigs.length === 0) {
        console.log('\n  ℹ️  Tous les exos historiques sont déjà dans le template → section 2 rare/absente.');
    } else if (!hasBothFromLast && !hasBothPartial) {
        console.log('\n  ℹ️  Exos hors template existent, mais pas de combinaison simulée avec section 1 > 0.');
        console.log('     Essaie : dernière séance + retirer un exo du template absent de cette séance.');
    }

    if (hasBothFromLast) {
        console.log('\n  ✅ Pour tester dans l’app : Record → programme → « Partir de la dernière séance »');
        console.log('     Puis scrolle en bas du workout : les 2 carousels devraient apparaître.');
    } else if (hasBothPartial) {
        console.log('\n  ✅ Pour tester dans l’app : « Partir du programme », puis supprime des exos');
        console.log('     pour ne garder que le début du template + vérifie les exos hors template en section 2.');
    }

    return {
        programId,
        name: program.name,
        hasBothFromLast,
        hasBothPartial,
        performedOnlyCount: performedOnlySigs.length,
        section1FromLast: fromLast.section1.length,
        section2FromLast: fromLast.section2.length,
    };
}

async function main() {
    const userId = parseArg('userId') || process.env.AUDIT_USER_ID;
    const programIdFilter = parseArg('programId');
    const verbose = hasFlag('verbose');

    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in .env');
    }
    if (!userId) {
        throw new Error('Pass --userId=... (or set AUDIT_USER_ID in .env)');
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error(`Invalid userId: ${userId}`);
    }

    await mongoose.connect(`${mongoUrl}${database}`);
    console.log('Connecté à MongoDB\n');
    console.log(`User: ${userId}`);
    if (programIdFilter) console.log(`Filtre programme: ${programIdFilter}`);

    const userOid = new mongoose.Types.ObjectId(userId);
    const query = { user: userOid, isArchived: { $ne: true } };
    if (programIdFilter) query._id = new mongoose.Types.ObjectId(programIdFilter);

    const programs = await UserProgram.find(query).lean();
    if (!programs.length) {
        console.log('Aucun programme trouvé.');
        await mongoose.disconnect();
        return;
    }

    console.log(`Programmes à analyser: ${programs.length}`);

    const results = [];
    for (const program of programs) {
        const result = await auditProgram(userOid, program, verbose || Boolean(programIdFilter));
        if (result) results.push(result);
    }

    console.log('\n' + '='.repeat(72));
    console.log('RÉSUMÉ');
    const withBothLast = results.filter((r) => r.hasBothFromLast);
    const withBothPartial = results.filter((r) => r.hasBothPartial);
    const withPerformedOnly = results.filter((r) => r.performedOnlyCount > 0);

    console.log(`Programmes analysés (affichés): ${results.length}`);
    console.log(`Avec les 2 sections (dernière séance): ${withBothLast.length}`);
    console.log(`Avec les 2 sections (simulation partielle): ${withBothPartial.length}`);
    console.log(`Avec au moins 1 exo historique hors template: ${withPerformedOnly.length}`);

    if (withBothLast.length === 0 && withBothPartial.length === 0) {
        console.log('\nConclusion probable : pas un bug UI — tes historiques ⊆ templates.');
        console.log('Pour voir la section 2, il faut une séance passée avec un exo');
        console.log('qui n\'est PAS dans program.program[] (ajouté à la volée lors d\'une séance).');
    } else if (withBothLast[0]) {
        const pick = withBothLast[0];
        console.log(`\nMeilleur candidat « dernière séance » : ${pick.name} (${pick.programId})`);
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await mongoose.disconnect();
    } catch {
        // ignore
    }
    process.exit(1);
});
