const shift = require('../lib/shift');

module.exports = function (app) {
    // Create a new shift
    app.post('/shift/create', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { type } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            if (!type) {
                return res.status(400).json({
                    success: false,
                    message: 'Type is required'
                });
            }

            if (!['remote', 'office'].includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: 'Type must be either "remote" or "office"'
                });
            }

            const newShift = await shift.createShift(userId, type);
            res.json({ success: true, shift: newShift });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Start a break
    app.put('/shift/breakStart', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { breakTime } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const updatedShift = await shift.breakStart(userId, breakTime ? new Date(breakTime) : null);
            res.json({ success: true, shift: updatedShift });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Stop a break
    app.put('/shift/breakStop', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { breakTime } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const updatedShift = await shift.breakStop(userId, breakTime ? new Date(breakTime) : null);
            res.json({ success: true, shift: updatedShift });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get current active shift
    app.get('/shift/get', async (req, res) => {
        try {
            const userId = req.query.userId;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const activeShift = await shift.getActiveShift(userId);
            res.json({ success: true, shift: activeShift });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // End shift
    app.put('/shift/end', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { endTime } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const endedShift = await shift.endShift(userId, endTime ? new Date(endTime) : null);
            res.json({ success: true, shift: endedShift });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get shift statistics for the current year
    app.get('/shift/stats', async (req, res) => {
        try {
            const userId = req.query.userId;
            const includeActive = req.query.includeActive !== 'false'; // Default to true

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const stats = await shift.getStats(userId, includeActive);
            res.json({ success: true, stats });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
};

