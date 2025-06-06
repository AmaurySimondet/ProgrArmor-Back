const notification = require('../lib/notification');

module.exports = function (app) {
    // GET notifications for a user
    app.get('/notifications', async (req, res) => {
        try {
            const userId = req.query.userId;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'User ID is required' });
            }
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
            if (!notificationId) {
                return res.status(400).json({ success: false, message: 'Notification ID is required' });
            }
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
            if (!userId) {
                return res.status(400).json({ success: false, message: 'User ID is required' });
            }
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
            if (!notificationId) {
                return res.status(400).json({ success: false, message: 'Notification ID is required' });
            }
            await notification.deleteNotification(notificationId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Bulk mark notifications as read
    app.put('/notifications/bulk-read', async (req, res) => {
        try {
            console.log("Bulk marking notifications as read", req.body, req.query, req.params);
            const notificationIds = req.body.notificationIds;
            if (!notificationIds || !Array.isArray(notificationIds)) {
                return res.status(400).json({ success: false, message: 'Invalid notificationIds' });
            }
            await notification.bulkMarkAsRead(notificationIds);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete a notification
    app.delete('/notifications/delete', async (req, res) => {
        try {
            const notificationId = req.body.notificationId;
            if (!notificationId) {
                return res.status(400).json({ success: false, message: 'Notification ID is required' });
            }
            await notification.deleteNotification(notificationId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });


    // Bulk delete notifications
    app.delete('/notifications/bulk-delete', async (req, res) => {
        try {
            const notificationIds = req.body.notificationIds;
            if (!notificationIds || !Array.isArray(notificationIds)) {
                return res.status(400).json({ success: false, message: 'Invalid notificationIds' });
            }
            await notification.bulkDeleteNotifications(notificationIds);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 