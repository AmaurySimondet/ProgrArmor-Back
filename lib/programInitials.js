const mongoose = require('mongoose');
const ProgramFolder = require('../schema/programFolder');
const UserProgram = require('../schema/userProgram');

const INITIALS_MAX_LENGTH = 3;

function normalizeInitials(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase().slice(0, INITIALS_MAX_LENGTH);
}

function deriveInitialsFromName(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned) return 'PRG';
    const letters = cleaned.replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, '').replace(/\s+/g, '');
    if (letters.length >= INITIALS_MAX_LENGTH) {
        return letters.slice(0, INITIALS_MAX_LENGTH).toUpperCase();
    }
    if (letters.length > 0) {
        return letters.toUpperCase().padEnd(INITIALS_MAX_LENGTH, letters[letters.length - 1].toUpperCase());
    }
    return cleaned.slice(0, INITIALS_MAX_LENGTH).toUpperCase().padEnd(INITIALS_MAX_LENGTH, 'X');
}

async function getUsedInitialsForUser(userId, exclude = {}) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const [folderInitials, programInitials] = await Promise.all([
        ProgramFolder.find({ user: userObjectId }, { initials: 1 }).lean(),
        UserProgram.find({ user: userObjectId }, { initials: 1 }).lean(),
    ]);
    const used = new Set();
    [...folderInitials, ...programInitials].forEach((row) => {
        const initials = normalizeInitials(row?.initials);
        if (!initials) return;
        if (exclude.folderId && String(row._id) === String(exclude.folderId)) return;
        if (exclude.programId && String(row._id) === String(exclude.programId)) return;
        used.add(initials);
    });
    return used;
}

async function resolveUniqueInitials(userId, requestedInitials, nameFallback, exclude = {}) {
    const base = normalizeInitials(requestedInitials) || deriveInitialsFromName(nameFallback);
    const used = await getUsedInitialsForUser(userId, exclude);
    if (!used.has(base)) return base;

    for (let i = 1; i <= 99; i += 1) {
        const suffix = String(i);
        const trimmedBase = base.slice(0, Math.max(1, INITIALS_MAX_LENGTH - suffix.length));
        const candidate = `${trimmedBase}${suffix}`.slice(0, INITIALS_MAX_LENGTH);
        if (!used.has(candidate)) return candidate;
    }
    throw new Error('Unable to generate unique initials');
}

function assertValidInitials(initials) {
    const normalized = normalizeInitials(initials);
    if (!normalized || normalized.length === 0 || normalized.length > INITIALS_MAX_LENGTH) {
        throw new Error(`Initials must be 1-${INITIALS_MAX_LENGTH} characters`);
    }
    return normalized;
}

module.exports = {
    INITIALS_MAX_LENGTH,
    normalizeInitials,
    deriveInitialsFromName,
    getUsedInitialsForUser,
    resolveUniqueInitials,
    assertValidInitials,
};
