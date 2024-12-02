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
            const dateMin = req.query.dateMin;
            const dateMax = req.query.dateMax;
            const fields = req.query.fields;
            const sets = await set.getSets(userId, seanceId, exercice, categories, unit, value, weightLoad, elastic, dateMin, dateMax, fields);
            res.json({ success: true, sets });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/pr', async (req, res) => {
        try {
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const prs = await set.getPRs(userId, exercice, categories);
            res.json({ success: true, prs });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/topExercices', async (req, res) => {
        try {
            const userId = req.query.userId;
            const topExercices = await set.getTopExercices(userId);
            res.json({ success: true, topExercices });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.get('/topFormat', async (req, res) => {
        try {
            const userId = req.query.userId;
            const topFormat = await set.getTopFormat(userId);
            res.json({ success: true, topFormat });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // POST
    app.post('/createSet', async (req, res) => {
        try {
            const setData = req.body.set;
            const newSet = await set.createSet(setData);
            res.json({ success: true, newSet });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // DELETE
    app.delete('/deleteSets', async (req, res) => {
        try {
            const seanceId = req.query.seanceId;
            await set.deleteSets(seanceId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}