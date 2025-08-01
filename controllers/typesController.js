const Type = require('../schema/type');
const { getOrSetCache } = require('../utils/cache');

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/types', async (req, res) => {
        try {
            const types = await getOrSetCache('types_all', async () => {
                return await Type.find({}).sort({ popularityScore: -1 });
            });

            res.json({
                success: true,
                types
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 