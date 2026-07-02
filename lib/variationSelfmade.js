const mongoose = require('mongoose');
const Variation = require('../schema/variation');
const Type = require('../schema/type');
const { normalizeString } = require('../utils/string');

const DEFAULT_BODYWEIGHT_RATIO = 0.8;
const EMPTY_DETAIL_POPULARITY = {
    global: 0,
    bodyweight_plus_external: 0,
    external_free: 0,
    external_machine: 0,
};

const VARIATION_SELECT = '-mergedNamesEmbedding';
const POPULATE_LIST = [
    { path: 'type', select: 'name megatype normalizedName' },
    { path: 'megatype', select: 'name normalizedName' },
];

function toObjectId(value) {
    if (!value) return null;
    if (!mongoose.Types.ObjectId.isValid(value)) return null;
    return new mongoose.Types.ObjectId(value);
}

function normalizeNames(name) {
    if (!name?.fr || !name?.en) {
        throw new Error('name.fr and name.en are required');
    }
    return {
        name: { fr: String(name.fr).trim(), en: String(name.en).trim() },
        normalizedName: {
            fr: normalizeString(name.fr),
            en: normalizeString(name.en),
        },
    };
}

async function resolveMegatypeFromType(typeId) {
    if (!typeId) return null;
    const typeDoc = await Type.findById(typeId).select('megatype').lean();
    if (!typeDoc) throw new Error('Type not found');
    return typeDoc.megatype || null;
}

function buildSelfmadeCreatePayload(raw = {}) {
    const isExercice = Boolean(raw.isExercice);
    const includeBodyweight = isExercice ? Boolean(raw.includeBodyweight) : false;
    const payload = {
        type: toObjectId(raw.type),
        isExercice,
        isUnilateral: isExercice ? Boolean(raw.isUnilateral) : false,
        includeBodyweight,
        selfmade: true,
        verified: false,
        defaultMode: 'repetitions',
        popularity: isExercice ? 0 : { ...EMPTY_DETAIL_POPULARITY },
    };

    if (raw.name) {
        Object.assign(payload, normalizeNames(raw.name));
    }

    if (includeBodyweight) {
        payload.exerciseBodyWeightRatio = DEFAULT_BODYWEIGHT_RATIO;
    }

    return payload;
}

function getNormalizedNameTokens(name = {}) {
    const tokens = new Set();
    const fr = normalizeString(name.fr || '');
    const en = normalizeString(name.en || '');
    if (fr) tokens.add(fr);
    if (en) tokens.add(en);
    return [...tokens];
}

function hasNormalizedNameConflict(name, isExercice, existingDocs = []) {
    const tokens = getNormalizedNameTokens(name);
    if (!tokens.length) return false;
    return existingDocs.some((doc) => {
        if (doc?.isExercice !== isExercice) return false;
        const docFr = doc?.normalizedName?.fr || '';
        const docEn = doc?.normalizedName?.en || '';
        return tokens.some((token) => token === docFr || token === docEn);
    });
}

async function findSelfmadeNameConflicts({ name, isExercice }, limit = 3) {
    const tokens = getNormalizedNameTokens(name);
    if (!tokens.length) return [];

    const docs = await Variation.find({
        isExercice: Boolean(isExercice),
        $or: [
            { 'normalizedName.fr': { $in: tokens } },
            { 'normalizedName.en': { $in: tokens } },
        ],
    })
        .select('name normalizedName isExercice selfmade')
        .limit(Math.max(1, limit))
        .lean();

    return docs.filter((doc) => hasNormalizedNameConflict(name, isExercice, [doc]));
}

async function assertSelfmadeNameAvailable({ name, isExercice }) {
    const existing = await findSelfmadeNameConflicts({ name, isExercice }, 3);
    if (!existing.length) return;

    const error = new Error('A variation with this name already exists');
    error.statusCode = 409;
    error.existing = existing.map((doc) => ({
        _id: doc._id,
        name: doc.name,
    }));
    throw error;
}

async function createSelfmadeVariation(rawPayload, userId) {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) {
        const error = new Error('userId is required');
        error.statusCode = 401;
        throw error;
    }

    const payload = buildSelfmadeCreatePayload(rawPayload);
    if (!payload.type) throw new Error('type is required');
    if (payload.isExercice === undefined) throw new Error('isExercice is required');
    if (!payload.name) throw new Error('name.fr and name.en are required');

    await assertSelfmadeNameAvailable({
        name: payload.name,
        isExercice: payload.isExercice,
    });

    payload.madeByUser = userObjectId;
    payload.megatype = await resolveMegatypeFromType(payload.type);

    const created = await Variation.create(payload);
    return Variation.findById(created._id)
        .select(VARIATION_SELECT)
        .populate(POPULATE_LIST)
        .lean();
}

module.exports = {
    DEFAULT_BODYWEIGHT_RATIO,
    buildSelfmadeCreatePayload,
    hasNormalizedNameConflict,
    findSelfmadeNameConflicts,
    assertSelfmadeNameAvailable,
    createSelfmadeVariation,
};
