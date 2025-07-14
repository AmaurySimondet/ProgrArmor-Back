const variation = require('../lib/variation');

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/variation/search', async (req, res) => {
        try {
            const search = req.query.search;
            const type = req.query.type;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 7;
            const { variations, total } = await variation.getVariationBySearch(search, type, page, limit);
            res.json({
                success: true,
                variations,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get('/variation/all', async (req, res) => {
        try {
            const type = req.query.type;
            const { variations, total } = await variation.getAllVariations(type);
            res.json({
                success: true,
                variations,
                total
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 