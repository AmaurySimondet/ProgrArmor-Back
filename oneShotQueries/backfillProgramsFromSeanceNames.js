/**
 * One-shot : crée UserProgram depuis seance.name uniques, lie seances + sets.
 * Idempotent : re-run ne duplique pas les programmes ni ne réécrit les liens existants.
 *
 * Usage : node oneShotQueries/backfillProgramsFromSeanceNames.js
 *         node oneShotQueries/backfillProgramsFromSeanceNames.js --userId=<id>
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Seance = require('../schema/seance');
const Seanceset = require('../schema/seanceset');
const UserProgram = require('../schema/userProgram');
const { resolveUniqueInitials } = require('../lib/programInitials');
const { pickRandomColor } = require('../lib/programFolder');
const {
    buildProgramTemplateFromSeanceSets,
    countDistinctExercisesInSets,
} = require('../lib/programTemplate');

const DEFAULT_COLORS = [
    '#ffe0ed', '#fff9e0', '#edffd9', '#f5e6ff', '#e6f9fa', '#e6fff6',
];

function pickColorForName(name) {
    return pickRandomColor(name);
}

async function findBestSeanceForTemplate(seanceIds) {
    let bestSeanceId = null;
    let bestCount = -1;
    for (const seanceId of seanceIds) {
        const sets = await Seanceset.find({ seance: seanceId }).lean();
        const count = countDistinctExercisesInSets(sets);
        if (count > bestCount) {
            bestCount = count;
            bestSeanceId = seanceId;
        }
    }
    return bestSeanceId;
}

async function backfillForUser(userId) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const seances = await Seance.find({ user: userObjectId, name: { $exists: true, $ne: '' } })
        .sort({ date: -1 })
        .lean();

    const groups = new Map();
    seances.forEach((seance) => {
        const key = String(seance.name || '').trim();
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(seance);
    });

    let createdPrograms = 0;
    let linkedSeances = 0;
    let linkedSets = 0;

    for (const [name, groupSeances] of groups.entries()) {
        let userProgram = await UserProgram.findOne({ user: userObjectId, name }).lean();
        if (!userProgram) {
            const initials = await resolveUniqueInitials(userId, null, name);
            const bestSeanceId = await findBestSeanceForTemplate(groupSeances.map((s) => s._id));
            let programTemplate = [];
            if (bestSeanceId) {
                const sets = await Seanceset.find({ seance: bestSeanceId }).lean();
                programTemplate = buildProgramTemplateFromSeanceSets(sets);
            }
            const created = await UserProgram.create({
                user: userObjectId,
                name,
                initials,
                color: pickColorForName(name),
                program: programTemplate,
                isArchived: false,
                lastSeanceId: groupSeances[0]?._id || null,
            });
            userProgram = created.toObject();
            createdPrograms += 1;
        }

        const programId = userProgram._id;
        const seanceIdsToLink = groupSeances
            .filter((s) => !s.program || String(s.program) !== String(programId))
            .map((s) => s._id);

        if (seanceIdsToLink.length > 0) {
            const seanceResult = await Seance.updateMany(
                { _id: { $in: seanceIdsToLink }, $or: [{ program: { $exists: false } }, { program: null }] },
                { $set: { program: programId } }
            );
            linkedSeances += seanceResult.modifiedCount || 0;

            const setResult = await Seanceset.updateMany(
                { seance: { $in: seanceIdsToLink }, $or: [{ program: { $exists: false } }, { program: null }] },
                { $set: { program: programId } }
            );
            linkedSets += setResult.modifiedCount || 0;
        }

        const latest = groupSeances[0];
        if (latest && (!userProgram.lastSeanceId || String(userProgram.lastSeanceId) !== String(latest._id))) {
            await UserProgram.updateOne({ _id: programId }, { $set: { lastSeanceId: latest._id } });
        }
    }

    return { createdPrograms, linkedSeances, linkedSets, groupCount: groups.size };
}

async function main() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    console.log('Connected to database:', process.env.DATABASE);

    const userIdArg = process.argv.find((arg) => arg.startsWith('--userId='));
    const userId = userIdArg ? userIdArg.split('=')[1] : null;

    try {
        if (userId) {
            const result = await backfillForUser(userId);
            console.log(`User ${userId}:`, result);
        } else {
            const userIds = await Seance.distinct('user');
            let totals = { createdPrograms: 0, linkedSeances: 0, linkedSets: 0, groupCount: 0 };
            for (const uid of userIds) {
                try {
                    const result = await backfillForUser(String(uid));
                    totals.createdPrograms += result.createdPrograms;
                    totals.linkedSeances += result.linkedSeances;
                    totals.linkedSets += result.linkedSets;
                    totals.groupCount += result.groupCount;
                    console.log(`User ${uid}:`, result);
                } catch (userErr) {
                    console.error(`User ${uid} failed:`, userErr.message);
                }
            }
            console.log('Totals:', totals);
        }
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

main();
