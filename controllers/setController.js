const set = require('../lib/set.js');

module.exports = function (app) {
    //SEANCE
    app.get('/sets', async (req, res) => {
        try {
            console.log("Fetching all sets");
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
}