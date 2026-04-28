const Notification = require('../schema/notification');

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
        const notifications = await Notification.find({ forUser: userId })
            .populate('fromUser', 'fName lName profilePic')
            .sort({ createdAt: -1 })
            .limit(50);
        return notifications;
    } catch (error) {
        throw error;
    }
}

/**
 * Marks a notification as read
 * @param {string} notificationId - The notification ID
 * @returns {Promise<Object>} - A promise that resolves to the updated notification
 */
async function markAsRead(notificationId, ownerUserId) {
    try {
        const notification = await Notification.findOneAndUpdate(
            ownerUserId ? { _id: notificationId, forUser: ownerUserId } : { _id: notificationId },
            { read: true },
            { new: true }
        );

        if (!notification) {
            throw new Error('Notification not found');
        }

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
async function deleteNotification(notificationId, ownerUserId) {
    try {
        const notification = await Notification.findOneAndDelete(
            ownerUserId ? { _id: notificationId, forUser: ownerUserId } : { _id: notificationId }
        );

        if (!notification) {
            throw new Error('Notification not found');
        }

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
async function bulkMarkAsRead(notificationIds, ownerUserId) {
    try {
        const result = await Notification.updateMany(
            ownerUserId
                ? { _id: { $in: notificationIds }, forUser: ownerUserId }
                : { _id: { $in: notificationIds } },
            { read: true }
        );

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
async function bulkDeleteNotifications(notificationIds, ownerUserId) {
    try {
        const result = await Notification.deleteMany(
            ownerUserId
                ? { _id: { $in: notificationIds }, forUser: ownerUserId }
                : { _id: { $in: notificationIds } }
        );

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