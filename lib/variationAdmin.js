const mongoose = require('mongoose');
const Variation = require('../schema/variation');
const Type = require('../schema/type');
const Seanceset = require('../schema/seanceset');
const VariationProgressionEdge = require('../schema/variationProgressionEdge');
const { schema: { MUSCLES } } = require('../constants');
const { normalizeString } = require('../utils/string');
const { getVariationProgressionNeighbors } = require('./variationProgressionEdge');

const WEIGHT_TYPES = ['bodyweight_plus_external', 'external_free', 'external_machine'];
const VARIATION_SELECT = '-mergedNamesEmbedding';
const POPULATE_LIST = [
    { path: 'type', select: 'name megatype normalizedName' },
    { path: 'megatype', select: 'name normalizedName' },
    { path: 'equivalentTo', select: 'name normalizedName isExercice' },
    { path: 'progressionReferenceVariationId', select: 'name normalizedName isExercice' },
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

function validateMuscles(muscles) {
    if (!muscles) return { primary: [], secondary: [] };
    const primary = Array.isArray(muscles.primary) ? muscles.primary : [];
    const secondary = Array.isArray(muscles.secondary) ? muscles.secondary : [];
    const invalid = [...primary, ...secondary].filter((m) => !MUSCLES.includes(m));
    if (invalid.length) {
        throw new Error(`Invalid muscle(s): ${invalid.join(', ')}`);
    }
    return { primary, secondary };
}

function validateWeightType(weightType) {
    if (weightType === undefined || weightType === null || weightType === '') return undefined;
    if (!WEIGHT_TYPES.includes(weightType)) {
        throw new Error(`Invalid weightType: ${weightType}`);
    }
    return weightType;
}

async function resolveMegatypeFromType(typeId, explicitMegatype) {
    if (explicitMegatype) return toObjectId(explicitMegatype);
    if (!typeId) return null;
    const typeDoc = await Type.findById(typeId).select('megatype').lean();
    if (!typeDoc) throw new Error('Type not found');
    return typeDoc.megatype || null;
}

function stripDeprecatedFields(payload) {
    const next = { ...payload };
    delete next.mergedNames;
    delete next.mergedNamesEmbedding;
    return next;
}

function buildVariationPayload(raw) {
    const payload = stripDeprecatedFields({ ...raw });

    if (payload.name) {
        Object.assign(payload, normalizeNames(payload.name));
    }

    if (payload.muscles !== undefined) {
        payload.muscles = validateMuscles(payload.muscles);
    }

    if (payload.weightType !== undefined) {
        payload.weightType = validateWeightType(payload.weightType);
    }

    if (payload.equivalentTo !== undefined) {
        payload.equivalentTo = (Array.isArray(payload.equivalentTo) ? payload.equivalentTo : [])
            .map((id) => toObjectId(id))
            .filter(Boolean);
    }

    if (payload.progressionReferenceVariationId !== undefined) {
        const refId = payload.progressionReferenceVariationId;
        payload.progressionReferenceVariationId = refId ? toObjectId(refId) : null;
    }

    if (payload.type !== undefined) {
        payload.type = toObjectId(payload.type);
    }

    return payload;
}

const listAdminVariations = async ({
    search,
    type,
    isExercice,
    verified,
    page = 1,
    limit = 30,
} = {}) => {
    const query = {};
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
    const skip = (safePage - 1) * safeLimit;

    if (search && String(search).trim()) {
        const term = String(search).trim();
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [
            { 'name.fr': regex },
            { 'name.en': regex },
            { 'normalizedName.fr': regex },
            { 'normalizedName.en': regex },
        ];
    }

    const typeId = toObjectId(type);
    if (type) {
        if (!typeId) return { variations: [], total: 0 };
        query.type = typeId;
    }

    if (isExercice === true || isExercice === false) query.isExercice = isExercice;
    if (verified === true || verified === false) query.verified = verified;

    const [variations, total] = await Promise.all([
        Variation.find(query)
            .select(VARIATION_SELECT)
            .populate(POPULATE_LIST)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .lean(),
        Variation.countDocuments(query),
    ]);

    return { variations, total, page: safePage, limit: safeLimit };
};

const getAdminVariationById = async (id) => {
    const objectId = toObjectId(id);
    if (!objectId) return null;

    const variation = await Variation.findById(objectId)
        .select(VARIATION_SELECT)
        .populate(POPULATE_LIST)
        .lean();

    if (!variation) return null;

    const neighbors = await getVariationProgressionNeighbors(objectId, { isActive: undefined });

    return { variation, neighbors };
};

const createAdminVariation = async (rawPayload) => {
    const payload = buildVariationPayload(rawPayload);

    if (!payload.type) throw new Error('type is required');
    if (payload.isExercice === undefined) throw new Error('isExercice is required');
    if (payload.selfmade === undefined) throw new Error('selfmade is required');
    if (!payload.name) throw new Error('name.fr and name.en are required');

    payload.megatype = await resolveMegatypeFromType(payload.type, payload.megatype);

    const created = await Variation.create(payload);
    return Variation.findById(created._id)
        .select(VARIATION_SELECT)
        .populate(POPULATE_LIST)
        .lean();
};

const updateAdminVariation = async (id, rawPayload) => {
    const objectId = toObjectId(id);
    if (!objectId) return null;

    const existing = await Variation.findById(objectId);
    if (!existing) return null;

    const payload = buildVariationPayload(rawPayload);

    if (payload.type !== undefined || payload.megatype !== undefined) {
        const typeId = payload.type !== undefined ? payload.type : existing.type;
        const explicitMegatype = payload.megatype !== undefined ? payload.megatype : existing.megatype;
        payload.megatype = await resolveMegatypeFromType(typeId, explicitMegatype);
    }

    Object.assign(existing, payload);
    await existing.save();

    return Variation.findById(objectId)
        .select(VARIATION_SELECT)
        .populate(POPULATE_LIST)
        .lean();
};

const assertVariationNotUsedInSeanceSets = async (variationObjectIds) => {
    const usages = await Seanceset.aggregate([
        { $match: { 'variations.variation': { $in: variationObjectIds } } },
        { $unwind: '$variations' },
        { $match: { 'variations.variation': { $in: variationObjectIds } } },
        {
            $group: {
                _id: '$variations.variation',
                usageCount: { $sum: 1 },
            },
        },
    ]);

    if (!usages.length) return;

    const details = usages
        .map((row) => `${String(row._id)} (used ${row.usageCount} time(s))`)
        .join(', ');
    const error = new Error(`Variation is referenced in seance sets: ${details}`);
    error.statusCode = 409;
    throw error;
};

const deleteAdminVariation = async (id) => {
    const objectId = toObjectId(id);
    if (!objectId) return null;

    const existing = await Variation.findById(objectId).lean();
    if (!existing) return null;

    await assertVariationNotUsedInSeanceSets([objectId]);

    await VariationProgressionEdge.deleteMany({
        $or: [
            { fromVariationId: objectId },
            { toVariationId: objectId },
            { contextVariationId: objectId },
        ],
    });

    await Variation.deleteOne({ _id: objectId });
    return existing;
};

module.exports = {
    listAdminVariations,
    getAdminVariationById,
    createAdminVariation,
    updateAdminVariation,
    deleteAdminVariation,
};
