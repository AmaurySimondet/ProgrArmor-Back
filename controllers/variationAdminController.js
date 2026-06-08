const { ensureAdmin } = require('../lib/ensureAdmin');
const variationAdmin = require('../lib/variationAdmin');
const variationProgressionEdgeAdmin = require('../lib/variationProgressionEdgeAdmin');

function parseBooleanQuery(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

function handleError(res, err) {
    console.error(err);
    const status = err.statusCode || 400;
    res.status(status).json({ success: false, message: err.message });
}

module.exports = (router) => {
    router.get('/admin/me', ensureAdmin, (req, res) => {
        res.json({ success: true, isAdmin: true });
    });

    router.get('/admin/variations', ensureAdmin, async (req, res) => {
        try {
            const { variations, total, page, limit } = await variationAdmin.listAdminVariations({
                search: req.query.search,
                type: req.query.type,
                isExercice: parseBooleanQuery(req.query.isExercice),
                verified: parseBooleanQuery(req.query.verified),
                hasPicture: parseBooleanQuery(req.query.hasPicture),
                sortBy: req.query.sortBy,
                page: parseInt(req.query.page, 10) || 1,
                limit: parseInt(req.query.limit, 10) || 30,
            });

            res.json({
                success: true,
                variations,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit,
                },
            });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.get('/admin/variations/:id', ensureAdmin, async (req, res) => {
        try {
            const data = await variationAdmin.getAdminVariationById(req.params.id);
            if (!data) {
                return res.status(404).json({ success: false, message: 'Variation not found' });
            }
            res.json({ success: true, ...data });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.post('/admin/variations', ensureAdmin, async (req, res) => {
        try {
            const variation = await variationAdmin.createAdminVariation(req.body);
            res.status(201).json({ success: true, variation });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.patch('/admin/variations/:id', ensureAdmin, async (req, res) => {
        try {
            const variation = await variationAdmin.updateAdminVariation(req.params.id, req.body);
            if (!variation) {
                return res.status(404).json({ success: false, message: 'Variation not found' });
            }
            res.json({ success: true, variation });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.delete('/admin/variations/:id', ensureAdmin, async (req, res) => {
        try {
            const deleted = await variationAdmin.deleteAdminVariation(req.params.id);
            if (!deleted) {
                return res.status(404).json({ success: false, message: 'Variation not found' });
            }
            res.json({ success: true, variation: deleted });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.get('/admin/variation-progression-edges', ensureAdmin, async (req, res) => {
        try {
            const isActive = req.query.isActive === undefined
                ? undefined
                : req.query.isActive === 'true';

            const { edges, total } = await variationProgressionEdgeAdmin.listAdminVariationProgressionEdges({
                fromVariationId: req.query.fromVariationId,
                toVariationId: req.query.toVariationId,
                contextVariationId: req.query.contextVariationId,
                source: req.query.source,
                confidence: req.query.confidence,
                isActive,
                page: parseInt(req.query.page, 10) || 1,
                limit: parseInt(req.query.limit, 10) || 50,
            });

            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 50;

            res.json({
                success: true,
                edges,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit,
                },
            });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.get('/admin/variation-progression-edges/:id', ensureAdmin, async (req, res) => {
        try {
            const edge = await variationProgressionEdgeAdmin.getAdminVariationProgressionEdgeById(req.params.id);
            if (!edge) {
                return res.status(404).json({ success: false, message: 'Edge not found' });
            }
            res.json({ success: true, edge });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.post('/admin/variation-progression-edges', ensureAdmin, async (req, res) => {
        try {
            const edge = await variationProgressionEdgeAdmin.createAdminVariationProgressionEdge(req.body);
            res.status(201).json({ success: true, edge });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.patch('/admin/variation-progression-edges/:id', ensureAdmin, async (req, res) => {
        try {
            const edge = await variationProgressionEdgeAdmin.updateAdminVariationProgressionEdge(
                req.params.id,
                req.body
            );
            if (!edge) {
                return res.status(404).json({ success: false, message: 'Edge not found' });
            }
            res.json({ success: true, edge });
        } catch (err) {
            handleError(res, err);
        }
    });

    router.delete('/admin/variation-progression-edges/:id', ensureAdmin, async (req, res) => {
        try {
            const deleted = await variationProgressionEdgeAdmin.deleteAdminVariationProgressionEdge(req.params.id);
            if (!deleted) {
                return res.status(404).json({ success: false, message: 'Edge not found' });
            }
            res.json({ success: true, edge: deleted });
        } catch (err) {
            handleError(res, err);
        }
    });
};
