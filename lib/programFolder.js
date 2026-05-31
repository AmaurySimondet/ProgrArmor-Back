const mongoose = require('mongoose');
const ProgramFolder = require('../schema/programFolder');
const UserProgram = require('../schema/userProgram');
const {
    assertValidInitials,
    resolveUniqueInitials,
    normalizeInitials,
} = require('./programInitials');

const DEFAULT_COLORS = [
    '#ffe0ed', '#fff9e0', '#edffd9', '#f5e6ff', '#e6f9fa', '#e6fff6',
];

function pickRandomColor(seed = '') {
    const index = Math.abs(String(seed).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % DEFAULT_COLORS.length;
    return DEFAULT_COLORS[index];
}

async function assertInitialsAvailable(userId, initials, exclude = {}) {
    const normalized = assertValidInitials(initials);
    const resolved = await resolveUniqueInitials(userId, normalized, normalized, exclude);
    if (resolved !== normalized) {
        throw new Error('Initials already in use');
    }
    return normalized;
}

async function getProgramFolders(userId) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const folders = await ProgramFolder.find({ user: userObjectId }).sort({ name: 1 }).lean();
    const programCounts = await UserProgram.aggregate([
        { $match: { user: userObjectId, folder: { $ne: null } } },
        { $group: { _id: '$folder', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(programCounts.map((row) => [String(row._id), row.count]));
    return folders.map((folder) => ({
        ...folder,
        programCount: countMap.get(String(folder._id)) || 0,
    }));
}

async function createProgramFolder(userId, data) {
    const name = String(data?.name || '').trim();
    if (!name) throw new Error('Folder name is required');

    const initials = await resolveUniqueInitials(
        userId,
        data?.initials,
        name
    );
    const color = data?.color || pickRandomColor(`${userId}-${name}`);

    const folder = await ProgramFolder.create({
        user: userId,
        name,
        initials,
        color,
    });
    return folder.toObject();
}

async function updateProgramFolder(folderId, userId, data) {
    const folder = await ProgramFolder.findOne({ _id: folderId, user: userId });
    if (!folder) throw new Error('Folder not found or forbidden');

    if (data?.name != null) {
        const name = String(data.name).trim();
        if (!name) throw new Error('Folder name cannot be empty');
        folder.name = name;
    }
    if (data?.color != null) folder.color = data.color;
    if (data?.initials != null) {
        folder.initials = await assertInitialsAvailable(userId, data.initials, { folderId });
    }
    await folder.save();
    return folder.toObject();
}

async function deleteProgramFolder(folderId, userId) {
    const folder = await ProgramFolder.findOneAndDelete({ _id: folderId, user: userId });
    if (!folder) throw new Error('Folder not found or forbidden');
    await UserProgram.updateMany(
        { user: userId, folder: folderId },
        { $set: { folder: null } }
    );
    return { success: true };
}

module.exports = {
    pickRandomColor,
    getProgramFolders,
    createProgramFolder,
    updateProgramFolder,
    deleteProgramFolder,
    normalizeInitials,
};
