const variation = require('../lib/variation');

module.exports = (router) => {
    // Move this route BEFORE the /:id route
    router.get('/variation/all', async (req, res) => {
        try {
            const type = req.query.type;
            const sortBy = req.query.sortBy || 'popularity';
            const userId = req.query.userId;
            const verified = req.query.verified === 'true' ? true : (req.query.verified === 'false' ? false : undefined);
            const isExercice = req.query.isExercice === 'true' ? true : (req.query.isExercice === 'false' ? false : undefined);
            const myExercices = req.query.myExercices === 'true' ? true : (req.query.myExercices === 'false' ? false : undefined);
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const { variations, total } = await variation.getAllVariations(type, sortBy, userId, page, limit, verified, isExercice, myExercices);

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
            const sortBy = req.query.sortBy || 'popularity';
            const verified = req.query.verified === 'true' ? true : (req.query.verified === 'false' ? false : undefined);
            const isExercice = req.query.isExercice === 'true' ? true : (req.query.isExercice === 'false' ? false : undefined);
            const myExercices = req.query.myExercices === 'true' ? true : (req.query.myExercices === 'false' ? false : undefined);
            const userId = req.query.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 7;
            const { variations, total } = await variation.getVariationBySearch(search, type, sortBy, page, limit, verified, isExercice, myExercices, userId);
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
            const results = await variation.getVariationByAI(search);
            res.json({
                success: true,
                results
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get('/variation/:id/equivalents', async (req, res) => {
        try {
            const raw = req.query.level;
            const maxLevel = raw === undefined || raw === ''
                ? 3
                : Math.min(3, Math.max(0, parseInt(raw, 10)));
            if (Number.isNaN(maxLevel)) {
                return res.status(400).json({ success: false, message: 'Invalid level' });
            }
            const result = await variation.getVariationEquivalents(req.params.id, maxLevel);
            res.json({
                success: true,
                level: maxLevel,
                variation: result.inputVariation,
                directEquivalent: result.directEquivalent,
                equivalentSecondLevel: result.equivalentSecondLevel,
                equivalentThirdLevel: result.equivalentThirdLevel,
                equivalentFourthLevel: result.equivalentFourthLevel
            });
        } catch (err) {
            if (err.statusCode === 404) {
                return res.status(404).json({ success: false, message: err.message });
            }
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