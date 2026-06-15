const mongoose = require('mongoose');
const Seance = require('../schema/seance');
const SeanceSet = require('../schema/seanceset');
const { buildProgramTemplateFromSeanceSets } = require('./programTemplate');
const { getProgramByIdForUser } = require('./userProgram');

const MAX_EXERCISES = 30;

function buildVariationSignature(entry) {
    const variationIds = Array.isArray(entry?.variationIds) ? entry.variationIds : [];
    return [...variationIds].map(String).sort().join('|');
}

/**
 * Distinct exercises performed in past seances of a program, with sets from the most recent occurrence.
 */
async function getProgramPerformedExercises(userId, programId) {
    if (!userId || !programId) {
        throw new Error('userId and programId are required');
    }
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(programId)) {
        throw new Error('Invalid userId or programId');
    }

    const program = await getProgramByIdForUser(programId, userId);
    if (!program) {
        throw new Error('Program not found or forbidden');
    }

    const userOid = new mongoose.Types.ObjectId(userId);
    const programOid = new mongoose.Types.ObjectId(programId);

    const seances = await Seance.find({ user: userOid, program: programOid })
        .select('_id date')
        .sort({ date: -1 })
        .lean();

    if (!seances.length) {
        return [];
    }

    const seenSignatures = new Set();
    const exercises = [];

    for (const seance of seances) {
        const sets = await SeanceSet.find({ seance: seance._id, user: userOid }).lean();
        const templateEntries = buildProgramTemplateFromSeanceSets(sets);

        for (const entry of templateEntries) {
            const signature = buildVariationSignature(entry);
            if (!signature || seenSignatures.has(signature)) continue;

            seenSignatures.add(signature);
            exercises.push({
                ...entry,
                variationIds: (entry.variationIds || []).map(String),
                lastPerformedAt: seance.date,
            });

            if (exercises.length >= MAX_EXERCISES) {
                break;
            }
        }

        if (exercises.length >= MAX_EXERCISES) {
            break;
        }
    }

    exercises.sort((a, b) => new Date(b.lastPerformedAt) - new Date(a.lastPerformedAt));
    return exercises;
}

module.exports = {
    getProgramPerformedExercises,
    MAX_EXERCISES,
};
