const mongoose = require('mongoose');
const UserProgram = require('../schema/userProgram');
const ProgramFolder = require('../schema/programFolder');
const Seance = require('../schema/seance');
const Seanceset = require('../schema/seanceset');
const AwsImage = require('../schema/awsImage');
const SeanceComment = require('../schema/seanceComment');
const Reaction = require('../schema/reaction');
const Notification = require('../schema/notification');
const { resolveUniqueInitials, assertValidInitials } = require('./programInitials');
const { pickRandomColor } = require('./programFolder');
const { computeProgramSuggestions } = require('./programSuggestions');
const {
    getExampleDefinition,
    getProgramExampleById,
    getProgramExamples,
} = require('./programExamples');
const { programNamesMatch, buildExactNameRegex } = require('./programName');

async function assertNameAvailable(userId, name, excludeProgramId = null) {
    const normalized = String(name || '').trim();
    if (!normalized) throw new Error('Program name is required');

    const query = {
        user: userId,
        name: { $regex: buildExactNameRegex(normalized) },
    };
    if (excludeProgramId) {
        query._id = { $ne: excludeProgramId };
    }

    const existing = await UserProgram.findOne(query).lean();
    if (existing) {
        throw new Error('Program name already in use');
    }
    return normalized;
}

async function assertInitialsAvailableForProgram(userId, initials, excludeProgramId = null) {
    const normalized = assertValidInitials(initials);
    const resolved = await resolveUniqueInitials(userId, normalized, normalized, {
        programId: excludeProgramId,
    });
    if (resolved !== normalized) {
        throw new Error('Initials already in use');
    }
    return normalized;
}

async function validateFolderOwnership(userId, folderId) {
    if (!folderId) return null;
    const folder = await ProgramFolder.findOne({ _id: folderId, user: userId }).lean();
    if (!folder) throw new Error('Folder not found or forbidden');
    return folder;
}

function buildProgramQuery(userId, { folderId, archived, includeFolderless } = {}) {
    const query = { user: new mongoose.Types.ObjectId(userId) };
    if (archived === true || archived === 'true') {
        query.isArchived = true;
    } else if (archived === false || archived === 'false') {
        query.isArchived = false;
    }
    if (folderId === 'null' || folderId === '' || includeFolderless) {
        query.folder = null;
    } else if (folderId) {
        query.folder = new mongoose.Types.ObjectId(folderId);
    }
    return query;
}

async function attachProgramListMeta(programs) {
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
    const statsMap = new Map(stats.map((row) => [String(row._id), row]));
    const enriched = programs.map((program) => {
        const stat = statsMap.get(String(program._id));
        return {
            ...program,
            seanceCount: stat?.count || 0,
            lastSeanceDate: stat?.lastSeanceDate || null,
        };
    });
    enriched.sort((a, b) => {
        const dateA = a.lastSeanceDate ? new Date(a.lastSeanceDate).getTime() : 0;
        const dateB = b.lastSeanceDate ? new Date(b.lastSeanceDate).getTime() : 0;
        if (dateB !== dateA) return dateB - dateA;
        return (a.name || '').localeCompare(b.name || '', 'fr');
    });
    return enriched;
}

async function getPrograms(userId, options = {}) {
    const query = buildProgramQuery(userId, options);
    const programs = await UserProgram.find(query).lean();
    return attachProgramListMeta(programs);
}

async function getProgramById(programId, userId) {
    const program = await UserProgram.findOne({ _id: programId, user: userId }).lean();
    if (!program) throw new Error('Program not found or forbidden');

    const [withCount] = await attachProgramListMeta([program]);
    let lastSeance = null;
    if (program.lastSeanceId) {
        lastSeance = await Seance.findById(program.lastSeanceId)
            .select('date title description _id name')
            .lean();
    }
    if (!lastSeance) {
        lastSeance = await Seance.findOne({ program: programId, user: userId })
            .sort({ date: -1 })
            .select('date title description _id name')
            .lean();
    }
    return { ...withCount, lastSeance, lastSeanceDate: lastSeance?.date || withCount.lastSeanceDate || null };
}

async function createProgram(userId, data) {
    const name = await assertNameAvailable(userId, data?.name);

    await validateFolderOwnership(userId, data?.folder || null);

    const initials = await resolveUniqueInitials(userId, data?.initials, name);
    const color = data?.color || pickRandomColor(`${userId}-${name}`);
    const programTemplate = Array.isArray(data?.program) ? data.program : [];

    const sourceExampleId = data?.sourceExampleId
        ? String(data.sourceExampleId).trim()
        : null;

    const created = await UserProgram.create({
        user: userId,
        name,
        initials,
        color,
        folder: data?.folder || null,
        program: programTemplate,
        sourceExampleId: sourceExampleId || null,
        isArchived: false,
    });
    return created.toObject();
}

async function ensureProgramFromExample(userId, exampleId) {
    const definition = getExampleDefinition(exampleId);
    const existing = await UserProgram.findOne({
        user: userId,
        sourceExampleId: definition.id,
    }).lean();

    if (existing) {
        const example = await getProgramExampleById(exampleId);
        await UserProgram.updateOne(
            { _id: existing._id, user: userId },
            { $set: { program: example.program } }
        );
        const updated = await UserProgram.findOne({ _id: existing._id, user: userId }).lean();
        const [withMeta] = await attachProgramListMeta([updated]);
        return withMeta;
    }

    const example = await getProgramExampleById(exampleId);
    const program = await createProgram(userId, {
        name: example.name,
        initials: example.initials,
        color: example.color,
        program: example.program,
        sourceExampleId: example.id,
    });
    return program;
}

async function updateProgram(programId, userId, data) {
    const program = await UserProgram.findOne({ _id: programId, user: userId });
    if (!program) throw new Error('Program not found or forbidden');

    if (data?.name != null) {
        const name = String(data.name).trim();
        if (!name) throw new Error('Program name cannot be empty');
        if (!programNamesMatch(program.name, name)) {
            await assertNameAvailable(userId, name, programId);
        }
        program.name = name;
    }
    if (data?.color != null) program.color = data.color;
    if (data?.initials != null) {
        program.initials = await assertInitialsAvailableForProgram(userId, data.initials, programId);
    }
    if (data?.folder !== undefined) {
        if (data.folder) await validateFolderOwnership(userId, data.folder);
        program.folder = data.folder || null;
    }
    if (data?.program !== undefined) {
        program.program = Array.isArray(data.program) ? data.program : [];
    }
    if (data?.isArchived !== undefined) program.isArchived = Boolean(data.isArchived);

    await program.save();

    if (data?.name != null) {
        await Seance.updateMany(
            { user: userId, program: programId },
            { $set: { name: program.name } }
        );
    }

    return program.toObject();
}

async function deleteSeanceCascade(seanceId) {
    const seanceComments = await SeanceComment.find({ seance: seanceId }, { _id: 1 }).lean();
    const commentIds = seanceComments.map((c) => c._id);
    await Seanceset.deleteMany({ seance: seanceId });
    await AwsImage.deleteMany({ seanceId });
    await Reaction.deleteMany({ seance: seanceId });
    await SeanceComment.deleteMany({ seance: seanceId });
    const notificationQuery = commentIds.length > 0
        ? { $or: [{ seance: seanceId }, { comment: { $in: commentIds } }] }
        : { seance: seanceId };
    await Notification.deleteMany(notificationQuery);
    await Seance.findByIdAndDelete(seanceId);
}

async function deleteProgram(programId, userId) {
    const program = await UserProgram.findOne({ _id: programId, user: userId }).lean();
    if (!program) throw new Error('Program not found or forbidden');

    const seanceCount = await Seance.countDocuments({ program: programId, user: userId });
    const seances = await Seance.find({ program: programId, user: userId }, { _id: 1 }).lean();
    for (const seance of seances) {
        await deleteSeanceCascade(seance._id);
    }
    await UserProgram.findByIdAndDelete(programId);
    return {
        success: true,
        deletedSeanceCount: seanceCount,
        suggestArchive: seanceCount > 0,
    };
}

async function updateLastSeanceId(programId, seanceId) {
    const { updateLastSeanceId: updateLink } = require('./programSeanceLink');
    return updateLink(programId, seanceId);
}

async function getProgramSuggestions(userId) {
    return computeProgramSuggestions(userId);
}

async function getProgramByIdForUser(programId, userId) {
    return UserProgram.findOne({ _id: programId, user: userId }).lean();
}

module.exports = {
    getPrograms,
    getProgramById,
    createProgram,
    updateProgram,
    deleteProgram,
    updateLastSeanceId,
    getProgramSuggestions,
    getProgramByIdForUser,
    getProgramExamples,
    ensureProgramFromExample,
};
