const exercice = require('../lib/exercice');

module.exports = function (app) {
    // Get all exercises
    app.get('/exercices', async (req, res) => {
        try {
            console.log("Fetching all exercises");
            const exerciceType = req.query.exerciceType; // Optional query parameter
            const exercices = await exercice.getAllExercices(exerciceType);
            res.json({ success: true, exercices });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get an exercise by ID
    app.get('/exercice/:id', async (req, res) => {
        try {
            console.log("Fetching exercise by ID:", req.params.id);
            const exerciceId = req.params.id;
            const exercice = await exercice.getExerciceById(exerciceId);
            res.json({ success: true, exercice });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
