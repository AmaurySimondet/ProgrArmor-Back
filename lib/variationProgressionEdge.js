const mongoose = require("mongoose");
const VariationProgressionEdge = require("../schema/variationProgressionEdge");

function toOptionalObjectId(value) {
    if (!value) return undefined;
    if (!mongoose.Types.ObjectId.isValid(value)) return undefined;
    return new mongoose.Types.ObjectId(value);
}

const getVariationProgressionEdges = async ({
    fromVariationId,
    toVariationId,
    contextVariationId,
    isActive,
    source,
    confidence,
    page = 1,
    limit = 50
} = {}) => {
    const query = {};

    const fromId = toOptionalObjectId(fromVariationId);
    const toId = toOptionalObjectId(toVariationId);
    const contextId = toOptionalObjectId(contextVariationId);

    if (fromVariationId && !fromId) return { edges: [], total: 0 };
    if (toVariationId && !toId) return { edges: [], total: 0 };
    if (contextVariationId && !contextId) return { edges: [], total: 0 };

    if (fromId) query.fromVariationId = fromId;
    if (toId) query.toVariationId = toId;
    if (contextVariationId) query.contextVariationId = contextId;

    if (isActive === true || isActive === false) query.isActive = isActive;
    if (source) query.source = source;
    if (confidence) query.confidence = confidence;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    const [edges, total] = await Promise.all([
        VariationProgressionEdge.find(query)
            .populate("fromVariationId", "_id name normalizedName type isExercice")
            .populate("toVariationId", "_id name normalizedName type isExercice")
            .populate("contextVariationId", "_id name normalizedName type isExercice")
            .sort({ difficultyRatio: 1, createdAt: 1 })
            .skip(skip)
            .limit(safeLimit)
            .lean(),
        VariationProgressionEdge.countDocuments(query)
    ]);

    return { edges, total };
};

const getVariationProgressionNeighbors = async (variationId, options = {}) => {
    const nodeId = toOptionalObjectId(variationId);
    if (!nodeId) return { outgoing: [], incoming: [] };

    const { isActive = true, contextVariationId } = options;
    const contextId = toOptionalObjectId(contextVariationId);

    const baseQuery = {};
    if (isActive === true || isActive === false) baseQuery.isActive = isActive;
    if (contextVariationId) {
        if (!contextId) return { outgoing: [], incoming: [] };
        baseQuery.contextVariationId = contextId;
    }

    const [outgoing, incoming] = await Promise.all([
        VariationProgressionEdge.find({ ...baseQuery, fromVariationId: nodeId })
            .populate("toVariationId", "_id name normalizedName type isExercice")
            .sort({ difficultyRatio: 1, createdAt: 1 })
            .lean(),
        VariationProgressionEdge.find({ ...baseQuery, toVariationId: nodeId })
            .populate("fromVariationId", "_id name normalizedName type isExercice")
            .sort({ difficultyRatio: 1, createdAt: 1 })
            .lean()
    ]);

    return { outgoing, incoming };
};

module.exports = {
    getVariationProgressionEdges,
    getVariationProgressionNeighbors
};
