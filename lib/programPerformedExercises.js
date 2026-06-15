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

function groupSetsBySeanceId(seanceSets = []) {
    const setsBySeanceId = new Map();
    for (const setDoc of seanceSets) {
        const seanceId = setDoc?.seance != null ? String(setDoc.seance) : '';
        if (!seanceId) continue;
        if (!setsBySeanceId.has(seanceId)) {
            setsBySeanceId.set(seanceId, []);
        }
        setsBySeanceId.get(seanceId).push(setDoc);
    }
    return setsBySeanceId;
}

function collectPerformedExercisesFromSeances(seances = [], setsBySeanceId = new Map(), maxExercises = MAX_EXERCISES) {
    const seenSignatures = new Set();
    const exercises = [];

    for (const seance of seances) {
        const sets = setsBySeanceId.get(String(seance._id)) ?? [];
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

            if (exercises.length >= maxExercises) {
                break;
            }
        }

        if (exercises.length >= maxExercises) {
            break;
        }
    }

    exercises.sort((a, b) => new Date(b.lastPerformedAt) - new Date(a.lastPerformedAt));
    return exercises;
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

    const seanceIds = seances.map((seance) => seance._id);
    const allSets = await SeanceSet.find({ user: userOid, seance: { $in: seanceIds } }).lean();
    const setsBySeanceId = groupSetsBySeanceId(allSets);

    return collectPerformedExercisesFromSeances(seances, setsBySeanceId);
}

module.exports = {
    getProgramPerformedExercises,
    collectPerformedExercisesFromSeances,
    groupSetsBySeanceId,
    buildVariationSignature,
    MAX_EXERCISES,
};
