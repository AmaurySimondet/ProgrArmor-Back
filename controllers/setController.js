const set = require('../lib/set.js');

module.exports = function (app) {
    app.get('/sets', async (req, res) => {
        try {
            const seanceId = req.query.seanceId;
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const unit = req.query.unit;
            const value = req.query.value;
            const weightLoad = req.query.weightLoad;
            const elastic = req.query.elastic;
            const sets = await set.getSets(userId, seanceId, exercice, categories, unit, value, weightLoad, elastic);
            res.json({ success: true, sets });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/topExercices', async (req, res) => {
        try {
            const userId = req.query.userId;
            const topExercices = await set.getTopExercices(userId);
            console.log("Top exercices:", topExercices);
            res.json({ success: true, topExercices });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.post('/createSet', async (req, res) => {
        try {
            const setData = req.body.set;
            console.log(setData);
            const newSet = await set.createSet(setData);
            res.json({ success: true, newSet });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}