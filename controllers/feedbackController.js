const feedback = require('../lib/feedback');

module.exports = function (app) {
    // Create feedback
    app.post('/feedback', async (req, res) => {
        try {
            const { type, text, media } = req.body;
            const userId = req.query.userId;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            if (!type || !text) {
                return res.status(400).json({
                    success: false,
                    message: 'Type and text are required'
                });
            }

            const newFeedback = await feedback.createFeedback(userId, { type, text, media });
            res.json({ success: true, feedback: newFeedback });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get feedback (admin only)
    app.get('/feedback', async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const status = req.query.status;
            const type = req.query.type;

            const query = {};
            if (status) query.status = status;
            if (type) query.type = type;

            const result = await feedback.getFeedback(query, page, limit);
            res.json({ success: true, ...result });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Update feedback status (admin only)
    app.put('/feedback/:feedbackId/status', async (req, res) => {
        try {
            const { feedbackId } = req.params;
            const { status } = req.body;

            if (!status) {
                return res.status(400).json({
                    success: false,
                    message: 'Status is required'
                });
            }

            const updatedFeedback = await feedback.updateFeedbackStatus(feedbackId, status);
            res.json({ success: true, feedback: updatedFeedback });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 