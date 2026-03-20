const Megatype = require('../schema/megatype');

lookup_types = {
    from: "types",
    localField: "_id",
    foreignField: "megatype",
    as: "types",
    pipeline: [
        { $sort: { popularityScore: -1 } }
    ]
}

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/megatypes', async (req, res) => {
        try {
            const megatypes = await Megatype.aggregate([
                { $lookup: lookup_types },
                { $sort: { popularityScore: -1 } }
            ]);
            res.json({
                success: true,
                megatypes
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 