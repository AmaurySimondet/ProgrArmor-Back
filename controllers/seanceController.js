const seance = require('../lib/seance.js');

module.exports = function (app) {
    //SEANCE
    app.get('/seance/last', async (req, res) => {
        try {
            const userId = req.query.userId;
            const seanceName = req.query.seanceName; // Optional query parameter
            const field = req.query.field; // Optional query parameter
            const lastSeance = await seance.getLastSeance(userId, field, seanceName);
            res.json({ success: true, lastSeance });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.get('/seance/names', async (req, res) => {
        try {
            const userId = req.query.userId;
            const seanceNames = await seance.getSeanceNames(userId);
            res.json({ success: true, seanceNames });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.get("/seance", async (req, res) => {
        try {
            const id = req.query.id;
            const seanceData = await seance.getSeance(id);
            res.json({ success: true, seanceData });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.get("/seances", async (req, res) => {
        try {
            const user = req.query.user;
            const seances = await seance.getSeances(user);
            res.json({ success: true, seances });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.post("/createSeance", async (req, res) => {
        try {
            const seanceData = req.body.seance;
            const newSeance = await seance.createSeance(seanceData);
            res.json({ success: true, newSeance });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}