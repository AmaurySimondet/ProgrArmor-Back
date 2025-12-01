const shift = require('../lib/shift');

module.exports = function (app) {
    // Create a new shift
    app.post('/shift/create', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { type, startedAt, endedAt } = req.body;
            console.log('req.body', req.body);

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

            if (!['remote', 'office', 'off'].includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: 'Type must be either "remote", "office" or "off"'
                });
            }

            // For 'off' type, allow custom start and end times
            const options = {};
            if (type === 'off') {
                if (startedAt) options.startedAt = startedAt;
                if (endedAt) options.endedAt = endedAt;
            }

            const newShift = await shift.createShift(userId, type, options);
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

    // Get all shifts for a user
    app.get('/shift/all', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { limit, skip, startDate, endDate, type } = req.query;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const result = await shift.getAllShifts(userId, {
                limit: limit ? parseInt(limit) : undefined,
                skip: skip ? parseInt(skip) : undefined,
                startDate,
                endDate,
                type
            });
            res.json({ success: true, ...result });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Update a shift by ID
    app.put('/shift/update/:shiftId', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { shiftId } = req.params;
            const { type, startedAt, endedAt, breakDurationSeconds, active } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            if (!shiftId) {
                return res.status(400).json({
                    success: false,
                    message: 'Shift ID is required'
                });
            }

            const updatedShift = await shift.updateShift(shiftId, userId, {
                type,
                startedAt,
                endedAt,
                breakDurationSeconds,
                active
            });
            res.json({ success: true, shift: updatedShift });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete a shift by ID
    app.delete('/shift/delete/:shiftId', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { shiftId } = req.params;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            if (!shiftId) {
                return res.status(400).json({
                    success: false,
                    message: 'Shift ID is required'
                });
            }

            const deletedShift = await shift.deleteShift(shiftId, userId);
            res.json({ success: true, deletedShift });
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

    // Create or update shift parameters
    app.post('/shift/parameters', async (req, res) => {
        try {
            const userId = req.query.userId;
            const { breakDurationMinimumSeconds, netWorkTimeMinimumSeconds, weekSchedule } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const params = await shift.createOrUpdateShiftParameters(userId, {
                breakDurationMinimumSeconds,
                netWorkTimeMinimumSeconds,
                weekSchedule
            });
            res.json({ success: true, parameters: params });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get shift parameters
    app.get('/shift/parameters', async (req, res) => {
        try {
            const userId = req.query.userId;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const params = await shift.getShiftParameters(userId);
            res.json({ success: true, parameters: params });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get schedule (current and previous week stats with projections)
    app.get('/shift/schedule', async (req, res) => {
        try {
            const userId = req.query.userId;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            const schedule = await shift.getSchedule(userId);
            res.json({ success: true, schedule });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
};

