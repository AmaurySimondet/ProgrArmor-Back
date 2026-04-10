const Megatype = require('../schema/megatype');

const lookup_types = {
    from: "types",
    localField: "_id",
    foreignField: "megatype",
    as: "types",
    pipeline: [
        { $sort: { popularityScore: -1 } }
    ]
};

const parseBooleanQuery = (value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
};

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/megatypes', async (req, res) => {
        try {
            const onlyContainsExercises = parseBooleanQuery(req.query.onlyContainsExercises);
            const megatypeMatchStage = typeof onlyContainsExercises === "boolean"
                ? [{ $match: { onlyContainsExercises } }]
                : [];
            const typesLookupMatchStage = typeof onlyContainsExercises === "boolean"
                ? [{ $match: { onlyContainsExercises } }]
                : [];
            const typesLookupPipeline = [
                ...typesLookupMatchStage,
                ...lookup_types.pipeline
            ];

            const megatypes = await Megatype.aggregate([
                ...megatypeMatchStage,
                { $lookup: { ...lookup_types, pipeline: typesLookupPipeline } },
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