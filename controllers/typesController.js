const Type = require('../schema/type');

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/types', async (req, res) => {
        try {
            const types = await Type.find({}).sort({ popularityScore: -1 });

            res.json({
                success: true,
                types
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.get('/type/:id', async (req, res) => {
        try {
            const type = await Type.findById(req.params.id).select(req.query.fields).lean().exec();
            res.json({ success: true, type });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 