const exerciceType = require('../lib/exerciceType');

module.exports = function (app) {
    // Get all exercise types
    app.get('/exerciceTypes', async (req, res) => {
        try {
            console.log("Fetching all exercise types");
            const exerciceTypes = await exerciceType.getAllExerciceTypes();
            console.log("Fetched exercise types:", exerciceTypes);
            res.json({ success: true, exerciceTypes });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get an exercise type by ID
    app.get('/exerciceType', async (req, res) => {
        try {
            console.log("Fetching exercise type by ID:", req.params.id);
            const exerciceTypeId = req.query.id;
            const exerciceTypeReturned = await exerciceType.getExerciceTypeById(exerciceTypeId);
            res.json({ success: true, exerciceTypeReturned });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get an exercise type ID by name
    app.get('/exerciceTypeId', async (req, res) => {
        try {
            console.log("Fetching exercise type by name:", req.query.name);
            const exerciceTypeName = req.query.name;
            const exerciceTypeId = await exerciceType.getExerciceTypeByName(exerciceTypeName);
            res.json({ success: true, exerciceTypeId });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
