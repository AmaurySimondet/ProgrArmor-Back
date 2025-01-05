const Notification = require('../schema/notification');
const { getOrSetCache, invalidateCacheStartingWith } = require('../utils/cache');

/**
 * Creates or updates a notification
 * @param {Object} notificationData - The notification data
 * @returns {Promise<Object>} - A promise that resolves to the created/updated notification
 */
async function upsertNotification(notificationData) {
    try {
        // Create query to find existing notification
        const query = {
            type: notificationData.type,
            fromUser: notificationData.fromUser,
            forUser: notificationData.forUser
        };

        // Add optional fields to query if they exist
        if (notificationData.seance) query.seance = notificationData.seance;
        if (notificationData.comment) query.comment = notificationData.comment;

        const notification = await Notification.findOneAndUpdate(
            query,
            notificationData,
            {
                upsert: true,
                new: true
            }
        );

        // Invalidate cache for the recipient user
        await invalidateCacheStartingWith(`notifications_${notificationData.forUser}`);

        return notification;
    } catch (error) {
        throw error;
    }
}

/**
 * Gets notifications for a specific user
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} - A promise that resolves to an array of notifications
 */
async function getUserNotifications(userId) {
    try {
        const cacheKey = `notifications_${userId}`;
        return await getOrSetCache(cacheKey, async () => {
            const notifications = await Notification.find({ forUser: userId })
                .populate('fromUser', 'fName lName profilePic')
                .sort({ createdAt: -1 })
                .limit(50);
            return notifications;
        });
    } catch (error) {
        throw error;
    }
}

/**
 * Marks a notification as read
 * @param {string} notificationId - The notification ID
 * @returns {Promise<Object>} - A promise that resolves to the updated notification
 */
async function markAsRead(notificationId) {
    try {
        const notification = await Notification.findByIdAndUpdate(
            notificationId,
            { read: true },
            { new: true }
        );

        if (!notification) {
            throw new Error('Notification not found');
        }

        await invalidateCacheStartingWith(`notifications_${notification.forUser}`);
        return notification;
    } catch (error) {
        throw error;
    }
}

/**
 * Marks all notifications as read for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - A promise that resolves to the update result
 */
async function markAllAsRead(userId) {
    try {
        const result = await Notification.updateMany(
            { forUser: userId, read: false },
            { read: true }
        );

        await invalidateCacheStartingWith(`notifications_${userId}`);
        return result;
    } catch (error) {
        throw error;
    }
}

/**
 * Deletes a notification
 * @param {string} notificationId - The notification ID
 * @returns {Promise<Object>} - A promise that resolves to the deletion result
 */
async function deleteNotification(notificationId) {
    try {
        const notification = await Notification.findByIdAndDelete(notificationId);

        if (!notification) {
            throw new Error('Notification not found');
        }

        await invalidateCacheStartingWith(`notifications_${notification.forUser}`);
        return notification;
    } catch (error) {
        throw error;
    }
}

/**
 * Marks multiple notifications as read
 * @param {Array<string>} notificationIds - Array of notification IDs
 * @returns {Promise<Object>} - A promise that resolves to the update result
 */
async function bulkMarkAsRead(notificationIds) {
    try {
        const notifications = await Notification.find({ _id: { $in: notificationIds } });
        const userIds = [...new Set(notifications.map(n => n.forUser.toString()))];

        const result = await Notification.updateMany(
            { _id: { $in: notificationIds } },
            { read: true }
        );

        // Invalidate cache for all affected users
        await Promise.all(userIds.map(userId =>
            invalidateCacheStartingWith(`notifications_${userId}`)
        ));

        return result;
    } catch (error) {
        throw error;
    }
}

/**
 * Deletes multiple notifications
 * @param {Array<string>} notificationIds - Array of notification IDs
 * @returns {Promise<Object>} - A promise that resolves to the deletion result
 */
async function bulkDeleteNotifications(notificationIds) {
    try {
        const notifications = await Notification.find({ _id: { $in: notificationIds } });
        const userIds = [...new Set(notifications.map(n => n.forUser.toString()))];

        const result = await Notification.deleteMany({ _id: { $in: notificationIds } });

        // Invalidate cache for all affected users
        await Promise.all(userIds.map(userId =>
            invalidateCacheStartingWith(`notifications_${userId}`)
        ));

        return result;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    upsertNotification,
    getUserNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    bulkMarkAsRead,
    bulkDeleteNotifications
}; 