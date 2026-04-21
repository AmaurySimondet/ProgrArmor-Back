const mongoose = require("mongoose");
const VariationProgressionEdge = require("../schema/variationProgressionEdge");
const Variation = require("../schema/variation");

function toObjectIdOrNull(value) {
    if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
    return new mongoose.Types.ObjectId(value);
}

function toNodeId(value) {
    return value ? String(value) : null;
}

function toSortedSignature(ids) {
    return [...ids].map((id) => String(id)).sort().join("|");
}

async function buildCanonicalVariationMap(variationGroups) {
    const signatures = new Map();
    for (const group of variationGroups) {
        if (!Array.isArray(group) || group.length === 0) continue;
        signatures.set(toSortedSignature(group), group.map((id) => String(id)));
    }
    if (signatures.size === 0) return new Map();

    const conditions = [...signatures.values()].map((group) => ({
        equivalentTo: {
            $size: group.length,
            $all: group.map((id) => new mongoose.Types.ObjectId(id))
        },
        verified: true
    }));
    if (!conditions.length) return new Map();

    const matches = await Variation.find(
        { $or: conditions },
        { _id: 1, equivalentTo: 1 }
    )
        .sort({ popularity: -1, createdAt: 1 })
        .lean();

    const bySignature = new Map();
    for (const doc of matches) {
        const signature = toSortedSignature(doc.equivalentTo || []);
        if (!bySignature.has(signature)) {
            bySignature.set(signature, String(doc._id));
        }
    }
    return bySignature;
}

async function resolveCanonicalVariationIdFromIds(variationIds = []) {
    const ids = (variationIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length) return null;
    if (ids.length === 1) return ids[0];

    const map = await buildCanonicalVariationMap([ids]);
    return map.get(toSortedSignature(ids)) || ids[0];
}

async function buildAdjacencyList({ contextVariationId } = {}) {
    const contextId = toObjectIdOrNull(contextVariationId);
    if (contextVariationId && !contextId) return new Map();

    const query = { isActive: true };
    if (contextId) {
        // IMPORTANT:
        // Quand on a un contexte (main exercise), on doit quand même garder les edges
        // "généraux" (contextVariationId: null), sinon certaines transitions detail<->detail
        // restent introuvables.
        query.$or = [
            { contextVariationId: contextId },
            { contextVariationId: null }
        ];
    }

    const edges = await VariationProgressionEdge.find(
        query,
        { fromVariationId: 1, toVariationId: 1, difficultyRatio: 1, confidence: 1, contextVariationId: 1 }
    ).lean();

    // Priorise les edges contextuels sur les globaux en cas de doublon from->to.
    const edgeByDirection = new Map();
    for (const edge of edges) {
        const from = toNodeId(edge.fromVariationId);
        const to = toNodeId(edge.toVariationId);
        if (!from || !to) continue;
        const key = `${from}->${to}`;
        const existing = edgeByDirection.get(key);
        const edgeIsContextual = edge?.contextVariationId != null;
        const existingIsContextual = existing?.contextVariationId != null;
        if (!existing || (edgeIsContextual && !existingIsContextual)) {
            edgeByDirection.set(key, edge);
        }
    }

    const adjacency = new Map();
    for (const edge of edgeByDirection.values()) {
        const from = toNodeId(edge.fromVariationId);
        const to = toNodeId(edge.toVariationId);
        const ratio = Number(edge.difficultyRatio);
        if (!from || !to || !Number.isFinite(ratio) || ratio <= 0) continue;
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from).push({
            to,
            ratio,
            confidence: edge.confidence || "medium"
        });
    }
    return adjacency;
}

function getConfidenceScore(pathEdges) {
    if (!pathEdges.length) return 1;
    const scoreByConfidence = { low: 0.5, medium: 0.75, high: 1 };
    const values = pathEdges.map((edge) => scoreByConfidence[edge.confidence] || 0.75);
    return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 1000) / 1000;
}

function dijkstraRatio(adjacency, start, goal) {
    if (!start || !goal) {
        return { ratio: null, path: [], hops: 0, reason: "MISSING_NODE" };
    }
    if (start === goal) {
        return { ratio: 1, path: [start], hops: 0, confidenceScore: 1 };
    }

    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const visited = new Set();
    const queue = [{ node: start, cost: 0 }];

    while (queue.length > 0) {
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();
        if (!current) break;
        const { node, cost } = current;
        if (visited.has(node)) continue;
        visited.add(node);
        if (node === goal) break;

        const neighbors = adjacency.get(node) || [];
        for (const edge of neighbors) {
            // Coût non-négatif pour rester compatible Dijkstra,
            // y compris quand des edges inverses ont un ratio < 1.
            const edgeCost = Math.abs(Math.log(edge.ratio));
            if (!Number.isFinite(edgeCost)) continue;
            const nextCost = cost + edgeCost;
            const known = dist.get(edge.to);
            if (known === undefined || nextCost < known) {
                dist.set(edge.to, nextCost);
                prev.set(edge.to, { node, edge });
                queue.push({ node: edge.to, cost: nextCost });
            }
        }
    }

    if (!dist.has(goal)) {
        return { ratio: null, path: [], hops: 0, reason: "NO_PATH" };
    }

    const nodePath = [];
    const edgePath = [];
    let cursor = goal;
    while (cursor) {
        nodePath.push(cursor);
        const p = prev.get(cursor);
        if (!p) break;
        edgePath.push(p.edge);
        cursor = p.node;
    }
    nodePath.reverse();
    edgePath.reverse();

    const ratio = edgePath.reduce((acc, edge) => acc * edge.ratio, 1);
    return {
        ratio: Math.round((ratio + Number.EPSILON) * 1000000) / 1000000,
        path: nodePath,
        hops: Math.max(0, nodePath.length - 1),
        confidenceScore: getConfidenceScore(edgePath)
    };
}

async function getDifficultyRatio({
    fromVariationId,
    toVariationId,
    contextVariationId,
    adjacency: adjacencyInput = null
}) {
    const from = toNodeId(fromVariationId);
    const to = toNodeId(toVariationId);
    if (!from || !to) {
        return { ratio: null, path: [], hops: 0, reason: "INVALID_INPUT" };
    }

    const adjacency = adjacencyInput != null
        ? adjacencyInput
        : await buildAdjacencyList({ contextVariationId });
    const direct = dijkstraRatio(adjacency, from, to);
    if (Number.isFinite(Number(direct?.ratio)) && Number(direct.ratio) > 0) {
        return direct;
    }

    // Fallback bidirectionnel: si le sens direct n'existe pas,
    // on tente le chemin inverse puis on inverse le ratio.
    const reverse = dijkstraRatio(adjacency, to, from);
    if (Number.isFinite(Number(reverse?.ratio)) && Number(reverse.ratio) > 0) {
        const reversePath = Array.isArray(reverse.path) ? [...reverse.path].reverse() : [];
        const invertedRatio = 1 / Number(reverse.ratio);
        return {
            ratio: Math.round((invertedRatio + Number.EPSILON) * 1000000) / 1000000,
            path: reversePath,
            hops: Number.isFinite(Number(reverse.hops)) ? Number(reverse.hops) : Math.max(0, reversePath.length - 1),
            confidenceScore: Number.isFinite(Number(reverse.confidenceScore)) ? Number(reverse.confidenceScore) : null,
            reason: "REVERSE_PATH"
        };
    }

    return direct;
}

module.exports = {
    getDifficultyRatio,
    resolveCanonicalVariationIdFromIds,
    buildCanonicalVariationMap,
    toSortedSignature,
    buildAdjacencyList
};
