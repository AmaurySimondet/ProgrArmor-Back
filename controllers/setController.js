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
            const variations = req.query.variations;
            const sets = await set.getSets(userId, excludedSeanceId, seanceId, exercice, categories, unit, value, weightLoad, elasticTension, dateMin, dateMax, fields, variations);
            res.json({ success: true, sets });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/prs', async (req, res) => {
        try {
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const dateMin = req.query.dateMin;
            const variations = req.query.variations;
            const prs = await set.getPRs(userId, exercice, categories, dateMin, variations);
            res.json({ success: true, prs });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/ispr', async (req, res) => {
        try {
            const userId = req.query.userId;
            const seanceId = req.query.seanceId;
            const unit = req.query.unit;
            const value = parseFloat(req.query.value);
            const weightLoad = parseFloat(req.query.weightLoad);
            let elastic = null;
            if (req.query.elastic) {
                elastic = {
                    use: req.query.elastic?.use,
                    tension: parseFloat(req.query.elastic?.tension)
                };
            }
            const variations = req.query.variations;
            const isPersonalRecord = await set.isPersonalRecord(userId, seanceId, unit, value, weightLoad, elastic, variations);
            console.log("isPersonalRecord response for userId:", userId, "seanceId:", seanceId, "unit:", unit, "value:", value, "weightLoad:", weightLoad, "elastic:", elastic, "variations:", variations, "isPersonalRecord:", isPersonalRecord);
            res.json({ success: true, isPersonalRecord });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/topExercices', async (req, res) => {
        try {
            const userId = req.query.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;
            const seanceName = req.query.seanceName;

            const { topExercices, total } = await set.getTopExercices(userId, req.query.by, req.query.asc, page, limit, seanceName);

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

    app.get('/lastFormats', async (req, res) => {
        try {
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;

            const { lastFormats, total } = await set.getLastFormats(userId, exercice, categories, page, limit);
            res.json({
                success: true,
                lastFormats,
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