const Type = require('../schema/type');

const parseBooleanQuery = (value) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
};

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/types', async (req, res) => {
        try {
            const onlyContainsExercises = parseBooleanQuery(req.query.onlyContainsExercises);
            const query = typeof onlyContainsExercises === 'boolean'
                ? { onlyContainsExercises }
                : {};
            const types = await Type.find(query).sort({ popularityScore: -1 });

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