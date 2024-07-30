const seance = require('../lib/seance.js');

module.exports = function (app) {
    //SEANCE
    app.get('/seance/last', async (req, res) => {
        try {
            console.log("get last seance", req.query);
            const userId = req.query.userId;
            const seanceName = req.query.seanceName; // Optional query parameter
            const lastSeance = await seance.getLastSeance(userId, seanceName);
            res.json({ success: true, lastSeance });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.get('/seance/names', async (req, res) => {
        try {
            console.log("get seance names", req.query);
            const userId = req.query.userId;
            const seanceNames = await seance.getSeanceNames(userId);
            res.json({ success: true, seanceNames });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}