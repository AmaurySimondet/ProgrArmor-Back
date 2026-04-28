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
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }
            const seanceData = req.body.seance;
            if (!seanceData) {
                return res.status(400).json({ success: false, message: "Seance data is required" });
            }
            const photoIds = req.body.photoIds;
            const newSeance = await seance.createSeance(seanceData, photoIds, authenticatedUserId);
            res.json({ success: true, newSeance });
        } catch (err) {
            console.error("Error creating seance:", err);
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.delete("/deleteSeance", async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }
            const seanceId = req.query.seanceId;
            await seance.deleteSeance(seanceId, authenticatedUserId);
            res.json({ success: true });
        } catch (err) {
            const status = typeof err?.message === "string" && err.message.includes("forbidden") ? 403 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });
    app.put("/updateSeance", async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }
            const id = req.query.id;
            if (!id) {
                throw new Error("Seance ID is required");
            }
            const seanceData = req.body.seance;
            if (!seanceData) {
                throw new Error("Seance data is required");
            }
            const photoIds = req.body.photoIds;
            const updatedSeance = await seance.updateSeance(id, seanceData, photoIds, authenticatedUserId);
            res.json({ success: true, updatedSeance });
        } catch (err) {
            const status = typeof err?.message === "string" && err.message.includes("forbidden") ? 403 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });

    app.post("/seance/nameSuggestion", async (req, res) => {
        try {
            const payload = req.body || {};
            const result = await seance.getSeanceNameSuggestion(payload);
            res.json({
                success: true,
                suggestions: result.suggestions,
                patternLabel: result.patternLabel,
                loadTypeLabel: result.loadTypeLabel,
                intensityLabel: result.intensityLabel,
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
