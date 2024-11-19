const exercice = require('../lib/exercice');

module.exports = function (app) {
    // Get all exercises
    app.get('/exercices', async (req, res) => {
        try {
            const exerciceType = req.query.exerciceType; // Optional query parameter
            const exercices = await exercice.getAllExercices(exerciceType);
            res.json({ success: true, exercices });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get an exercise by ID
    app.get('/exercice', async (req, res) => {
        try {
            const exerciceId = req.query.id;
            const exerciceName = req.query.name;
            const fields = req.query.fields; // Optional query parameter
            const exerciceReturned = await exercice.getExerciceById(exerciceId, exerciceName, fields);
            res.json({ success: true, exerciceReturned });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
