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

    app.get('/combinations', async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 7;
            const search = req.query.search;

            const { combinations, total } = await exercice.getCombinations(page, limit, search);
            res.json({
                success: true,
                combinations,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
        }
        catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Create a new exercise
    app.post('/exercice', async (req, res) => {
        try {
            const exerciceData = req.body;
            const newExercice = await exercice.createExercice(exerciceData);
            res.json({ success: true, exercice: newExercice });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
