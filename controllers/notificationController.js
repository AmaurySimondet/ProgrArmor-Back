const notification = require('../lib/notification');

module.exports = function (app) {
    const getAuthenticatedUserId = (req) => (req.user && req.user._id ? req.user._id.toString() : null);

    // GET notifications for a user
    app.get('/notifications', async (req, res) => {
        try {
            const authenticatedUserId = getAuthenticatedUserId(req);
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const requestedUserId = req.query.userId ? String(req.query.userId) : authenticatedUserId;
            if (requestedUserId !== authenticatedUserId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
            const notifications = await notification.getUserNotifications(authenticatedUserId);
            res.json({ success: true, notifications });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Mark notification as read
    app.put('/notifications/read', async (req, res) => {
        try {
            const authenticatedUserId = getAuthenticatedUserId(req);
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const notificationId = req.body.notificationId;
            if (!notificationId) {
                return res.status(400).json({ success: false, message: 'Notification ID is required' });
            }
            await notification.markAsRead(notificationId, authenticatedUserId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Mark all notifications as read
    app.put('/notifications/readAll', async (req, res) => {
        try {
            const authenticatedUserId = getAuthenticatedUserId(req);
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            await notification.markAllAsRead(authenticatedUserId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete notification
    app.delete('/notifications', async (req, res) => {
        try {
            const authenticatedUserId = getAuthenticatedUserId(req);
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const notificationId = req.query.id;
            if (!notificationId) {
                return res.status(400).json({ success: false, message: 'Notification ID is required' });
            }
            await notification.deleteNotification(notificationId, authenticatedUserId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Bulk mark notifications as read
    app.put('/notifications/bulk-read', async (req, res) => {
        try {
            const authenticatedUserId = getAuthenticatedUserId(req);
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            console.log("Bulk marking notifications as read", req.body, req.query, req.params);
            const notificationIds = req.body.notificationIds;
            if (!notificationIds || !Array.isArray(notificationIds)) {
                return res.status(400).json({ success: false, message: 'Invalid notificationIds' });
            }
            await notification.bulkMarkAsRead(notificationIds, authenticatedUserId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete a notification
    app.delete('/notifications/delete', async (req, res) => {
        try {
            const authenticatedUserId = getAuthenticatedUserId(req);
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const notificationId = req.body.notificationId;
            if (!notificationId) {
                return res.status(400).json({ success: false, message: 'Notification ID is required' });
            }
            await notification.deleteNotification(notificationId, authenticatedUserId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });


    // Bulk delete notifications
    app.delete('/notifications/bulk-delete', async (req, res) => {
        try {
            const authenticatedUserId = getAuthenticatedUserId(req);
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const notificationIds = req.body.notificationIds;
            if (!notificationIds || !Array.isArray(notificationIds)) {
                return res.status(400).json({ success: false, message: 'Invalid notificationIds' });
            }
            await notification.bulkDeleteNotifications(notificationIds, authenticatedUserId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 