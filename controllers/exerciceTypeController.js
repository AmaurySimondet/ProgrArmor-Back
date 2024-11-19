const exerciceType = require('../lib/exerciceType');

module.exports = function (app) {
    // Get all exercise types
    app.get('/exerciceTypes', async (req, res) => {
        try {
            const exerciceTypes = await exerciceType.getAllExerciceTypes();
            res.json({ success: true, exerciceTypes });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get an exercise type by ID
    app.get('/exerciceType', async (req, res) => {
        try {
            const exerciceTypeId = req.query.id;
            const exerciceTypeName = req.query.name;
            const fields = req.query.fields; // Optional query parameter
            const exerciceTypeReturned = await exerciceType.getExerciceType(exerciceTypeId, exerciceTypeName, fields);
            res.json({ success: true, exerciceTypeReturned });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
