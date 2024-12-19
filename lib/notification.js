const mongoose = require('mongoose');
const Notification = require('../schema/notification');
const { getOrSetCache, invalidateCacheStartingWith } = require('../controllers/utils/cache');

/**
 * Creates a new notification
 * @param {Object} notificationData - The notification data
 * @returns {Promise<Object>} - A promise that resolves to the created notification
 */
async function createNotification(notificationData) {
    try {
        const notification = new Notification(notificationData);
        await notification.save();

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

module.exports = {
    createNotification,
    getUserNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification
}; 