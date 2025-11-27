const mongoose = require('mongoose');
const Shift = require('../schema/shift');

/**
 * Create a new shift for a user
 * @param {string} userId - The ID of the user
 * @param {string} type - The type of shift ('remote' or 'office')
 * @returns {Promise<Object>} - The newly created shift
 */
async function createShift(userId, type) {
    try {
        if (!['remote', 'office'].includes(type)) {
            throw new Error('Type must be either "remote" or "office"');
        }

        // Check if user already has an active shift
        const existingShift = await Shift.findOne({
            user: new mongoose.Types.ObjectId(userId),
            active: true
        });

        if (existingShift) {
            throw new Error('User already has an active shift');
        }

        const now = new Date();
        const newShift = new Shift({
            type,
            user: new mongoose.Types.ObjectId(userId),
            active: true,
            startedAt: now,
            endedAt: now // Will be updated when shift ends
        });

        await newShift.save();
        return newShift;
    } catch (err) {
        console.error("Error creating shift:", err);
        throw err;
    }
}

/**
 * Start a break for the current active shift
 * @param {string} userId - The ID of the user
 * @param {Date} breakTime - The time when break started
 * @returns {Promise<Object>} - The updated shift
 */
async function breakStart(userId, breakTime) {
    try {
        const shift = await Shift.findOne({
            user: new mongoose.Types.ObjectId(userId),
            active: true
        });

        if (!shift) {
            throw new Error('No active shift found');
        }

        if (shift.breakStartedAt && !shift.breakEndedAt) {
            throw new Error('Break already in progress');
        }

        shift.breakStartedAt = breakTime || new Date();
        shift.breakEndedAt = undefined;

        await shift.save();
        return shift;
    } catch (err) {
        console.error("Error starting break:", err);
        throw err;
    }
}

/**
 * Stop a break for the current active shift
 * @param {string} userId - The ID of the user
 * @param {Date} breakTime - The time when break ended
 * @returns {Promise<Object>} - The updated shift
 */
async function breakStop(userId, breakTime) {
    try {
        const shift = await Shift.findOne({
            user: new mongoose.Types.ObjectId(userId),
            active: true
        });

        if (!shift) {
            throw new Error('No active shift found');
        }

        if (!shift.breakStartedAt) {
            throw new Error('No break in progress');
        }

        if (shift.breakEndedAt) {
            throw new Error('Break already ended');
        }

        const endTime = breakTime || new Date();
        shift.breakEndedAt = endTime;

        // Calculate break duration in seconds and add to existing duration
        const breakDuration = Math.floor((new Date(endTime) - new Date(shift.breakStartedAt)) / 1000);
        shift.breakDurationSeconds = (shift.breakDurationSeconds || 0) + breakDuration;

        await shift.save();
        return shift;
    } catch (err) {
        console.error("Error stopping break:", err);
        throw err;
    }
}

/**
 * Get the current active shift for a user
 * @param {string} userId - The ID of the user
 * @returns {Promise<Object|null>} - The active shift or null
 */
async function getActiveShift(userId) {
    try {
        const shift = await Shift.findOne({
            user: new mongoose.Types.ObjectId(userId),
            active: true
        });

        return shift;
    } catch (err) {
        console.error("Error getting active shift:", err);
        throw err;
    }
}

/**
 * End the current active shift
 * @param {string} userId - The ID of the user
 * @param {Date} endTime - The time when shift ended
 * @returns {Promise<Object>} - The ended shift
 */
async function endShift(userId, endTime) {
    try {
        const shift = await Shift.findOne({
            user: new mongoose.Types.ObjectId(userId),
            active: true
        });

        if (!shift) {
            throw new Error('No active shift found');
        }

        // If break is in progress, end it first
        if (shift.breakStartedAt && !shift.breakEndedAt) {
            const breakEndTime = endTime || new Date();
            shift.breakEndedAt = breakEndTime;
            const breakDuration = Math.floor((new Date(breakEndTime) - new Date(shift.breakStartedAt)) / 1000);
            shift.breakDurationSeconds = (shift.breakDurationSeconds || 0) + breakDuration;
        }

        shift.active = false;
        shift.endedAt = endTime || new Date();

        await shift.save();
        return shift;
    } catch (err) {
        console.error("Error ending shift:", err);
        throw err;
    }
}

/**
 * Get shift statistics for the current year
 * @param {string} userId - The ID of the user
 * @param {boolean} includeActive - Whether to include active shift in stats
 * @returns {Promise<Object>} - Statistics object with worked times grouped by type, plus remote/office percentage ratios
 */
async function getStats(userId, includeActive = true) {
    try {
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);
        const startOfNextYear = new Date(currentYear + 1, 0, 1);

        const query = {
            user: new mongoose.Types.ObjectId(userId),
            startedAt: { $gte: startOfYear, $lt: startOfNextYear }
        };

        if (!includeActive) {
            query.active = false;
        }

        const shifts = await Shift.find(query);

        const stats = {
            remote: {
                totalSeconds: 0,
                totalBreakSeconds: 0,
                netSeconds: 0,
                shiftCount: 0
            },
            office: {
                totalSeconds: 0,
                totalBreakSeconds: 0,
                netSeconds: 0,
                shiftCount: 0
            },
            total: {
                totalSeconds: 0,
                totalBreakSeconds: 0,
                netSeconds: 0,
                shiftCount: 0
            }
        };

        const now = new Date();

        for (const shift of shifts) {
            const type = shift.type;
            const endTime = shift.active ? now : new Date(shift.endedAt);
            const startTime = new Date(shift.startedAt);

            // Calculate total shift duration in seconds
            const totalSeconds = Math.floor((endTime - startTime) / 1000);

            // Calculate break duration (including ongoing break if any)
            let breakSeconds = shift.breakDurationSeconds || 0;
            if (shift.active && shift.breakStartedAt && !shift.breakEndedAt) {
                // Add ongoing break duration
                breakSeconds += Math.floor((now - new Date(shift.breakStartedAt)) / 1000);
            }

            // Net work time = total - breaks
            const netSeconds = totalSeconds - breakSeconds;

            stats[type].totalSeconds += totalSeconds;
            stats[type].totalBreakSeconds += breakSeconds;
            stats[type].netSeconds += netSeconds;
            stats[type].shiftCount += 1;

            stats.total.totalSeconds += totalSeconds;
            stats.total.totalBreakSeconds += breakSeconds;
            stats.total.netSeconds += netSeconds;
            stats.total.shiftCount += 1;
        }

        // Convert seconds to human-readable format
        const formatTime = (seconds) => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            return {
                hours,
                minutes,
                seconds: secs,
                formatted: `${hours}h ${minutes}m ${secs}s`
            };
        };

        // Calculate % of times of remote over office type for all time buckets
        function getPercentage(numerator, denominator) {
            if (denominator === 0) return null;
            return Math.round((numerator / denominator) * 10000) / 100; // 2 decimal places
        }

        const percentRemote_over_Office = {
            totalSeconds: getPercentage(stats.remote.totalSeconds, stats.office.totalSeconds + stats.remote.totalSeconds),
            totalBreakSeconds: getPercentage(stats.remote.totalBreakSeconds, stats.office.totalBreakSeconds + stats.remote.totalBreakSeconds),
            netSeconds: getPercentage(stats.remote.netSeconds, stats.office.netSeconds + stats.remote.netSeconds),
            shiftCount: getPercentage(stats.remote.shiftCount, stats.office.shiftCount + stats.remote.shiftCount),
        };

        return {
            year: currentYear,
            includesActiveShift: includeActive,
            remote: {
                ...stats.remote,
                totalTime: formatTime(stats.remote.totalSeconds),
                totalBreakTime: formatTime(stats.remote.totalBreakSeconds),
                netTime: formatTime(stats.remote.netSeconds)
            },
            office: {
                ...stats.office,
                totalTime: formatTime(stats.office.totalSeconds),
                totalBreakTime: formatTime(stats.office.totalBreakSeconds),
                netTime: formatTime(stats.office.netSeconds)
            },
            total: {
                ...stats.total,
                totalTime: formatTime(stats.total.totalSeconds),
                totalBreakTime: formatTime(stats.total.totalBreakSeconds),
                netTime: formatTime(stats.total.netSeconds)
            },
            percentRemoteOverOffice: {
                totalSeconds: percentRemote_over_Office.totalSeconds,         // % remote.totalSeconds / office.totalSeconds
                totalBreakSeconds: percentRemote_over_Office.totalBreakSeconds, // % remote.totalBreakSeconds / office.totalBreakSeconds
                netSeconds: percentRemote_over_Office.netSeconds,               // % remote.netSeconds / office.netSeconds
                shiftCount: percentRemote_over_Office.shiftCount                // % remote.shiftCount / office.shiftCount
            }
        };
    } catch (err) {
        console.error("Error getting shift stats:", err);
        throw err;
    }
}

module.exports = {
    createShift,
    breakStart,
    breakStop,
    getActiveShift,
    endShift,
    getStats
};

