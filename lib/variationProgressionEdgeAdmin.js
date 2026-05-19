const mongoose = require('mongoose');
const Variation = require('../schema/variation');
const VariationProgressionEdge = require('../schema/variationProgressionEdge');
const { getVariationProgressionEdges } = require('./variationProgressionEdge');

function toObjectId(value) {
    if (!value) return null;
    if (!mongoose.Types.ObjectId.isValid(value)) return null;
    return new mongoose.Types.ObjectId(value);
}

async function enrichEdgePayload(raw) {
    const fromVariationId = toObjectId(raw.fromVariationId);
    const toVariationId = toObjectId(raw.toVariationId);
    if (!fromVariationId || !toVariationId) {
        throw new Error('fromVariationId and toVariationId are required');
    }

    const contextVariationId = raw.contextVariationId
        ? toObjectId(raw.contextVariationId)
        : null;

    if (raw.contextVariationId && !contextVariationId) {
        throw new Error('Invalid contextVariationId');
    }

    const difficultyRatio = Number(raw.difficultyRatio);
    if (!Number.isFinite(difficultyRatio) || difficultyRatio < 0) {
        throw new Error('difficultyRatio must be a number >= 0');
    }

    const [fromVariation, toVariation] = await Promise.all([
        Variation.findById(fromVariationId).select('name isExercice').lean(),
        Variation.findById(toVariationId).select('name isExercice').lean(),
    ]);

    if (!fromVariation) throw new Error('fromVariation not found');
    if (!toVariation) throw new Error('toVariation not found');

    const fromVariationName = raw.fromVariationName
        || fromVariation.name?.fr
        || fromVariation.name?.en
        || '';
    const toVariationName = raw.toVariationName
        || toVariation.name?.fr
        || toVariation.name?.en
        || '';

    return {
        fromVariationId,
        toVariationId,
        contextVariationId,
        fromVariationName,
        toVariationName,
        isExerciseVariation: raw.isExerciseVariation !== undefined
            ? Boolean(raw.isExerciseVariation)
            : Boolean(fromVariation.isExercice),
        difficultyRatio,
        confidence: raw.confidence || 'medium',
        source: raw.source || 'manual',
        notes: raw.notes || '',
        isActive: raw.isActive !== undefined ? Boolean(raw.isActive) : true,
    };
}

const listAdminVariationProgressionEdges = async (filters = {}) => {
    return getVariationProgressionEdges(filters);
};

const getAdminVariationProgressionEdgeById = async (id) => {
    const objectId = toObjectId(id);
    if (!objectId) return null;

    return VariationProgressionEdge.findById(objectId)
        .populate('fromVariationId', '_id name normalizedName isExercice')
        .populate('toVariationId', '_id name normalizedName isExercice')
        .populate('contextVariationId', '_id name normalizedName isExercice')
        .lean();
};

const createAdminVariationProgressionEdge = async (rawPayload) => {
    const payload = await enrichEdgePayload(rawPayload);

    const edge = await VariationProgressionEdge.findOneAndUpdate(
        {
            fromVariationId: payload.fromVariationId,
            toVariationId: payload.toVariationId,
            contextVariationId: payload.contextVariationId,
        },
        { $set: payload },
        { upsert: true, new: true, runValidators: true }
    );

    return VariationProgressionEdge.findById(edge._id)
        .populate('fromVariationId', '_id name normalizedName isExercice')
        .populate('toVariationId', '_id name normalizedName isExercice')
        .populate('contextVariationId', '_id name normalizedName isExercice')
        .lean();
};

const updateAdminVariationProgressionEdge = async (id, rawPayload) => {
    const objectId = toObjectId(id);
    if (!objectId) return null;

    const existing = await VariationProgressionEdge.findById(objectId);
    if (!existing) return null;

    const merged = {
        fromVariationId: rawPayload.fromVariationId ?? existing.fromVariationId,
        toVariationId: rawPayload.toVariationId ?? existing.toVariationId,
        contextVariationId: rawPayload.contextVariationId !== undefined
            ? rawPayload.contextVariationId
            : existing.contextVariationId,
        fromVariationName: rawPayload.fromVariationName,
        toVariationName: rawPayload.toVariationName,
        isExerciseVariation: rawPayload.isExerciseVariation,
        difficultyRatio: rawPayload.difficultyRatio ?? existing.difficultyRatio,
        confidence: rawPayload.confidence ?? existing.confidence,
        source: rawPayload.source ?? existing.source,
        notes: rawPayload.notes ?? existing.notes,
        isActive: rawPayload.isActive !== undefined ? rawPayload.isActive : existing.isActive,
    };

    const payload = await enrichEdgePayload(merged);

    if (
        String(existing.fromVariationId) !== String(payload.fromVariationId)
        || String(existing.toVariationId) !== String(payload.toVariationId)
        || String(existing.contextVariationId || '') !== String(payload.contextVariationId || '')
    ) {
        await VariationProgressionEdge.deleteOne({ _id: objectId });
        const recreated = await VariationProgressionEdge.findOneAndUpdate(
            {
                fromVariationId: payload.fromVariationId,
                toVariationId: payload.toVariationId,
                contextVariationId: payload.contextVariationId,
            },
            { $set: payload },
            { upsert: true, new: true, runValidators: true }
        );
        return VariationProgressionEdge.findById(recreated._id)
            .populate('fromVariationId', '_id name normalizedName isExercice')
            .populate('toVariationId', '_id name normalizedName isExercice')
            .populate('contextVariationId', '_id name normalizedName isExercice')
            .lean();
    }

    Object.assign(existing, payload);
    await existing.save();

    return VariationProgressionEdge.findById(objectId)
        .populate('fromVariationId', '_id name normalizedName isExercice')
        .populate('toVariationId', '_id name normalizedName isExercice')
        .populate('contextVariationId', '_id name normalizedName isExercice')
        .lean();
};

const deleteAdminVariationProgressionEdge = async (id) => {
    const objectId = toObjectId(id);
    if (!objectId) return null;

    const existing = await VariationProgressionEdge.findById(objectId).lean();
    if (!existing) return null;

    await VariationProgressionEdge.deleteOne({ _id: objectId });
    return existing;
};

module.exports = {
    listAdminVariationProgressionEdges,
    getAdminVariationProgressionEdgeById,
    createAdminVariationProgressionEdge,
    updateAdminVariationProgressionEdge,
    deleteAdminVariationProgressionEdge,
};
