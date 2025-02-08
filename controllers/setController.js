const set = require('../lib/set.js');

module.exports = function (app) {
    app.get('/sets', async (req, res) => {
        try {
            const excludedSeanceId = req.query.excludedSeanceId;
            const seanceId = req.query.seanceId;
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const unit = req.query.unit;
            const value = req.query.value;
            const weightLoad = req.query.weightLoad;
            const elasticTension = req.query['elastic.tension'];
            const dateMin = req.query.dateMin;
            const dateMax = req.query.dateMax;
            const fields = req.query.fields;
            const sets = await set.getSets(userId, excludedSeanceId, seanceId, exercice, categories, unit, value, weightLoad, elasticTension, dateMin, dateMax, fields);
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
            const dateMin = req.query.dateMin;
            const prs = await set.getPRs(userId, exercice, categories, dateMin);
            res.json({ success: true, prs });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/topExercices', async (req, res) => {
        try {
            const userId = req.query.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;

            const { topExercices, total } = await set.getTopExercices(userId, req.query.by, req.query.asc, page, limit);

            res.json({
                success: true,
                topExercices,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/topFormat', async (req, res) => {
        try {
            const userId = req.query.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;

            const { topFormat, total } = await set.getTopFormat(userId, page, limit);
            res.json({
                success: true,
                topFormat,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
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