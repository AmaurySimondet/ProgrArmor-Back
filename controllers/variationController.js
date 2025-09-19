const variation = require('../lib/variation');
const { getOrSetCache } = require('../utils/cache');

module.exports = (router) => {
    // Move this route BEFORE the /:id route
    router.get('/variation/all', async (req, res) => {
        try {
            const type = req.query.type;
            const sortBy = req.query.sortBy || 'name';
            const userId = req.query.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const { variations, total } = await variation.getAllVariations(type, sortBy, userId, page, limit);

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
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get('/variation/search', async (req, res) => {
        try {
            const search = req.query.search;
            const type = req.query.type;
            const sortBy = req.query.sortBy || 'name';
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 7;
            const { variations, total } = await variation.getVariationBySearch(search, type, sortBy, page, limit);
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

    router.get('/variation/rrf', async (req, res) => {
        try {
            const search = req.query.search;
            const type = req.query.type;
            const variations = await variation.getVariationByRRFSearch(search, type);
            res.json({
                success: true,
                variations
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get('/variation/ai', async (req, res) => {
        try {
            const search = req.query.search;
            const cacheKey = `variation_ai_${search}`;
            const results = await getOrSetCache(cacheKey, async () => {
                return await variation.getVariationByAI(search);
            });
            res.json({
                success: true,
                results
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });


    router.get('/variation/:id', async (req, res) => {
        try {
            const variationFetched = await variation.getVariationById(req.params.id, req.query.fields);
            res.json({ success: true, variation: variationFetched });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 