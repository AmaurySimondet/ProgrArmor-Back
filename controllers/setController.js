const set = require('../lib/set.js');

module.exports = function (app) {
    //SEANCE
    app.get('/sets', async (req, res) => {
        try {
            console.log("Fetching all sets");
            const seanceId = req.query.seanceId;
            const userId = req.query.userId;
            const sets = await set.getSets(userId, seanceId);
            res.json({ success: true, sets });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}