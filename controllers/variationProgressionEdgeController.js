const variationProgressionEdge = require("../lib/variationProgressionEdge");

module.exports = (router) => {
    router.get("/variation-progression-edge/all", async (req, res) => {
        try {
            const fromVariationId = req.query.fromVariationId;
            const toVariationId = req.query.toVariationId;
            const contextVariationId = req.query.contextVariationId;
            const source = req.query.source;
            const confidence = req.query.confidence;
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 50;

            const isActive = req.query.isActive === undefined
                ? undefined
                : req.query.isActive === "true";

            const { edges, total } = await variationProgressionEdge.getVariationProgressionEdges({
                fromVariationId,
                toVariationId,
                contextVariationId,
                isActive,
                source,
                confidence,
                page,
                limit
            });

            res.json({
                success: true,
                edges,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get("/variation-progression-edge/:variationId/neighbors", async (req, res) => {
        try {
            const { variationId } = req.params;
            const contextVariationId = req.query.contextVariationId;
            const isActive = req.query.isActive === undefined
                ? true
                : req.query.isActive === "true";

            const data = await variationProgressionEdge.getVariationProgressionNeighbors(variationId, {
                isActive,
                contextVariationId
            });

            res.json({ success: true, ...data });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });
};
