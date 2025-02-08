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
            let users = req.query.users;
            let seanceName = req.query.seanceName;
            if (users && typeof users === 'string') {
                users = users.split(',').map(id => id.trim());
            }
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 3;
            const seances = await seance.getSeances(users, page, limit, seanceName);
            res.json({ success: true, seances });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.post("/createSeance", async (req, res) => {
        try {
            const seanceData = req.body.seance;
            const photoIds = req.body.photoIds;
            const newSeance = await seance.createSeance(seanceData, photoIds);
            res.json({ success: true, newSeance });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.delete("/deleteSeance", async (req, res) => {
        try {
            const seanceId = req.query.seanceId;
            const user = req.query.user;
            await seance.deleteSeance(seanceId, user);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.put("/updateSeance", async (req, res) => {
        try {
            const id = req.query.id;
            const seanceData = req.body.seance;
            const photoIds = req.body.photoIds;
            const updatedSeance = await seance.updateSeance(id, seanceData, photoIds);
            res.json({ success: true, updatedSeance });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
