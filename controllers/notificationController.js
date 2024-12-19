const notification = require('../lib/notification');

module.exports = function (app) {
    // GET notifications for a user
    app.get('/notifications', async (req, res) => {
        try {
            console.log("Getting notifications for user", req.query.userId);
            const userId = req.query.userId;
            const notifications = await notification.getUserNotifications(userId);
            res.json({ success: true, notifications });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Mark notification as read
    app.put('/notifications/read', async (req, res) => {
        try {
            const notificationId = req.body.notificationId;
            await notification.markAsRead(notificationId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Mark all notifications as read
    app.put('/notifications/readAll', async (req, res) => {
        try {
            const userId = req.body.userId;
            await notification.markAllAsRead(userId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete notification
    app.delete('/notifications', async (req, res) => {
        try {
            const notificationId = req.query.id;
            await notification.deleteNotification(notificationId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 