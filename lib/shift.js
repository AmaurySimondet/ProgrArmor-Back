const mongoose = require('mongoose');
const Shift = require('../schema/shift');
const ShiftParameters = require('../schema/shiftparameters');

/**
 * Create a new shift for a user
 * @param {string} userId - The ID of the user
 * @param {string} type - The type of shift ('remote', 'office' or 'off')
 * @param {Object} options - Optional parameters for 'off' type
 * @param {Date} options.startedAt - Custom start time (only for 'off' type)
 * @param {Date} options.endedAt - Custom end time (only for 'off' type)
 * @returns {Promise<Object>} - The newly created shift
 */
async function createShift(userId, type, options = {}) {
    try {
        if (!['remote', 'office', 'off'].includes(type)) {
            throw new Error('Type must be either "remote", "office" or "off"');
        }

        const now = new Date();
        let startedAt = now;
        let endedAt = now;
        let isActive = true;
        console.log('options', now, startedAt, endedAt, isActive, options);

        // For 'off' type, allow custom start and end times
        if (type === 'off') {
            if (options.startedAt) {
                startedAt = new Date(options.startedAt);
            }
            if (options.endedAt) {
                endedAt = new Date(options.endedAt);
                // If end time is provided and different from start, the shift is complete
                if (options.endedAt !== options.startedAt) {
                    isActive = false;
                }
            }
        }

        // Check if user already has an active shift (only if creating an active shift)
        if (isActive) {
            const existingShift = await Shift.findOne({
                user: new mongoose.Types.ObjectId(userId),
                active: true
            });

            if (existingShift) {
                throw new Error('User already has an active shift');
            }
        }

        const newShift = new Shift({
            type,
            user: new mongoose.Types.ObjectId(userId),
            active: isActive,
            startedAt,
            endedAt
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
 * Get all shifts for a user
 * @param {string} userId - The ID of the user
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of shifts to return
 * @param {number} options.skip - Number of shifts to skip (for pagination)
 * @param {Date} options.startDate - Filter shifts starting from this date
 * @param {Date} options.endDate - Filter shifts ending before this date
 * @param {string} options.type - Filter by shift type ('remote', 'office', 'off')
 * @returns {Promise<Array>} - Array of shifts
 */
async function getAllShifts(userId, options = {}) {
    try {
        const { limit = 100, skip = 0, startDate, endDate, type } = options;

        const query = {
            user: new mongoose.Types.ObjectId(userId)
        };

        if (startDate || endDate) {
            query.startedAt = {};
            if (startDate) query.startedAt.$gte = new Date(startDate);
            if (endDate) query.startedAt.$lte = new Date(endDate);
        }

        if (type && ['remote', 'office', 'off'].includes(type)) {
            query.type = type;
        }

        const shifts = await Shift.find(query)
            .sort({ startedAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Shift.countDocuments(query);

        return { shifts, total, limit, skip };
    } catch (err) {
        console.error("Error getting all shifts:", err);
        throw err;
    }
}

/**
 * Update a shift by ID
 * @param {string} shiftId - The ID of the shift to update
 * @param {string} userId - The ID of the user (for verification)
 * @param {Object} updates - The fields to update
 * @returns {Promise<Object>} - The updated shift
 */
async function updateShift(shiftId, userId, updates) {
    try {
        const shift = await Shift.findOne({
            _id: new mongoose.Types.ObjectId(shiftId),
            user: new mongoose.Types.ObjectId(userId)
        });

        if (!shift) {
            throw new Error('Shift not found or does not belong to user');
        }

        const allowedUpdates = ['type', 'startedAt', 'endedAt', 'breakDurationSeconds', 'active'];

        for (const key of allowedUpdates) {
            if (updates[key] !== undefined) {
                if (key === 'type' && !['remote', 'office', 'off'].includes(updates[key])) {
                    throw new Error('Type must be either "remote", "office" or "off"');
                }
                if (key === 'startedAt' || key === 'endedAt') {
                    shift[key] = new Date(updates[key]);
                } else {
                    shift[key] = updates[key];
                }
            }
        }

        await shift.save();
        return shift;
    } catch (err) {
        console.error("Error updating shift:", err);
        throw err;
    }
}

/**
 * Delete a shift by ID
 * @param {string} shiftId - The ID of the shift to delete
 * @param {string} userId - The ID of the user (for verification)
 * @returns {Promise<Object>} - The deleted shift
 */
async function deleteShift(shiftId, userId) {
    try {
        const shift = await Shift.findOne({
            _id: new mongoose.Types.ObjectId(shiftId),
            user: new mongoose.Types.ObjectId(userId)
        });

        if (!shift) {
            throw new Error('Shift not found or does not belong to user');
        }

        await shift.deleteOne();
        return shift;
    } catch (err) {
        console.error("Error deleting shift:", err);
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
        const now = new Date();
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

        // Get user's shift parameters for expected calculations
        // (schedule = expected pattern, but we will adjust it with actual "off" shifts)
        const params = await getShiftParameters(userId);
        const netWorkTimeMinimumSeconds = params?.netWorkTimeMinimumSeconds || 25200; // 7 hours
        const breakDurationMinimumSeconds = params?.breakDurationMinimumSeconds || 3600; // 1 hour
        const weekSchedule = params?.weekSchedule || {
            monday: 'office',
            tuesday: 'office',
            wednesday: 'remote',
            thursday: 'office',
            friday: 'remote',
            saturday: 'off',
            sunday: 'off'
        };

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

        // First pass: collect stats for worked shifts (remote/office),
        // and track explicit "off" days to adjust expected values.
        const offDays = new Set();

        for (const shift of shifts) {
            const type = shift.type;

            // Track "off" days (full days off should reduce expectations)
            if (type === 'off') {
                const d = new Date(shift.startedAt);
                d.setHours(0, 0, 0, 0);
                offDays.add(d.toISOString());
                continue; // do not add to worked stats
            }

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

        // Calculate expected values for the year
        // Count work days from start of year to end of year based on schedule
        let expectedNetSeconds = 0;
        let expectedBreakSeconds = 0;
        let expectedRemoteShifts = 0;
        let expectedRemoteSeconds = 0;
        let expectedOfficeShifts = 0;
        let expectedOfficeSeconds = 0;
        let expectedTotalWorkDays = 0;


        // Count days from start of year up to today for "expected so far"
        let expectedSoFarNetSeconds = 0;
        let expectedSoFarRemoteShifts = 0;
        let expectedSoFarOfficeShifts = 0;
        let expectedSoFarTotalWorkDays = 0;
        let expectedSoFarRemoteSeconds = 0;
        let expectedSoFarOfficeSeconds = 0;

        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

        // Calculate expected for entire year
        const dayIterator = new Date(startOfYear);
        const endOfYear = new Date(startOfNextYear);
        endOfYear.setDate(endOfYear.getDate() - 1);

        while (dayIterator <= endOfYear) {
            const dayName = days[dayIterator.getDay()];
            const scheduleType = weekSchedule[dayName];
            const dayKey = (() => {
                const d = new Date(dayIterator);
                d.setHours(0, 0, 0, 0);
                return d.toISOString();
            })();

            // If user has explicitly logged an "off" shift that day,
            // we consider it a day off for expectations as well.
            const isExplicitOffDay = offDays.has(dayKey);

            if (scheduleType !== 'off' && !isExplicitOffDay) {
                expectedNetSeconds += netWorkTimeMinimumSeconds;
                expectedBreakSeconds += breakDurationMinimumSeconds;
                expectedTotalWorkDays += 1;

                if (scheduleType === 'remote') {
                    expectedRemoteShifts += 1;
                    expectedRemoteSeconds += netWorkTimeMinimumSeconds;
                } else if (scheduleType === 'office') {
                    expectedOfficeShifts += 1;
                    expectedOfficeSeconds += netWorkTimeMinimumSeconds;
                }

                // If day is in the past or today, count toward "expected so far"
                if (dayIterator <= now) {
                    expectedSoFarNetSeconds += netWorkTimeMinimumSeconds;
                    expectedSoFarTotalWorkDays += 1;
                    if (scheduleType === 'remote') {
                        expectedSoFarRemoteShifts += 1;
                        expectedSoFarRemoteSeconds += netWorkTimeMinimumSeconds;
                    } else if (scheduleType === 'office') {
                        expectedSoFarOfficeShifts += 1;
                        expectedSoFarOfficeSeconds += netWorkTimeMinimumSeconds;
                    }
                }
            }

            dayIterator.setDate(dayIterator.getDate() + 1);
        }

        // Convert seconds to human-readable format
        const formatTime = (seconds) => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
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

        // Expected remote percentage
        const expectedRemotePercent = getPercentage(expectedRemoteSeconds, expectedRemoteSeconds + expectedOfficeSeconds);
        const expectedSoFarRemotePercent = getPercentage(expectedSoFarRemoteSeconds, expectedSoFarRemoteSeconds + expectedSoFarOfficeSeconds);

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
                totalSeconds: percentRemote_over_Office.totalSeconds,
                totalBreakSeconds: percentRemote_over_Office.totalBreakSeconds,
                netSeconds: percentRemote_over_Office.netSeconds,
                shiftCount: percentRemote_over_Office.shiftCount
            },
            expected: {
                // Full year expected values
                yearTotal: {
                    netHours: formatTime(expectedNetSeconds),
                    breakHours: formatTime(expectedBreakSeconds),
                    remotePercent: expectedRemotePercent,
                    workDays: expectedTotalWorkDays,
                    remoteShifts: expectedRemoteShifts,
                    officeShifts: expectedOfficeShifts,
                    remoteSeconds: expectedRemoteSeconds,
                    officeSeconds: expectedOfficeSeconds
                },
                // Expected so far (up to today)
                soFar: {
                    netHours: formatTime(expectedSoFarNetSeconds),
                    remotePercent: expectedSoFarRemotePercent,
                    workDays: expectedSoFarTotalWorkDays,
                    remoteShifts: expectedSoFarRemoteShifts,
                    officeShifts: expectedSoFarOfficeShifts,
                    remoteSeconds: expectedSoFarRemoteSeconds,
                    officeSeconds: expectedSoFarOfficeSeconds
                }
            },
            progress: {
                // Current vs expected so far
                hoursPercent: getPercentage(stats.total.netSeconds, expectedSoFarNetSeconds),
                shiftsPercent: getPercentage(stats.total.shiftCount, expectedSoFarTotalWorkDays),
                // Current vs full year
                yearHoursPercent: getPercentage(stats.total.netSeconds, expectedNetSeconds),
                yearShiftsPercent: getPercentage(stats.total.shiftCount, expectedTotalWorkDays)
            }
        };
    } catch (err) {
        console.error("Error getting shift stats:", err);
        throw err;
    }
}

/**
 * Create or update shift parameters for a user
 * @param {string} userId - The ID of the user
 * @param {Object} params - The parameters to set
 * @returns {Promise<Object>} - The created/updated shift parameters
 */
async function createOrUpdateShiftParameters(userId, params) {
    try {
        const { breakDurationMinimumSeconds, netWorkTimeMinimumSeconds, weekSchedule } = params;

        // Validate weekSchedule if provided
        if (weekSchedule) {
            const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            const validTypes = ['office', 'remote', 'off'];
            for (const day of days) {
                if (weekSchedule[day] && !validTypes.includes(weekSchedule[day])) {
                    throw new Error(`Invalid type for ${day}: must be "office", "remote" or "off"`);
                }
            }
        }

        const existingParams = await ShiftParameters.findOne({
            user: new mongoose.Types.ObjectId(userId)
        });

        if (existingParams) {
            // Update existing parameters
            if (breakDurationMinimumSeconds !== undefined) {
                existingParams.breakDurationMinimumSeconds = breakDurationMinimumSeconds;
            }
            if (netWorkTimeMinimumSeconds !== undefined) {
                existingParams.netWorkTimeMinimumSeconds = netWorkTimeMinimumSeconds;
            }
            if (weekSchedule) {
                existingParams.weekSchedule = { ...existingParams.weekSchedule, ...weekSchedule };
            }
            await existingParams.save();
            return existingParams;
        } else {
            // Create new parameters with defaults if not provided
            const newParams = new ShiftParameters({
                user: new mongoose.Types.ObjectId(userId),
                breakDurationMinimumSeconds: breakDurationMinimumSeconds || 3600, // Default 1 hour
                netWorkTimeMinimumSeconds: netWorkTimeMinimumSeconds || 25200, // Default 7 hours
                weekSchedule: weekSchedule || {
                    monday: 'office',
                    tuesday: 'office',
                    wednesday: 'remote',
                    thursday: 'office',
                    friday: 'remote',
                    saturday: 'off',
                    sunday: 'off'
                }
            });
            await newParams.save();
            return newParams;
        }
    } catch (err) {
        console.error("Error creating/updating shift parameters:", err);
        throw err;
    }
}

/**
 * Get shift parameters for a user
 * @param {string} userId - The ID of the user
 * @returns {Promise<Object|null>} - The shift parameters or null
 */
async function getShiftParameters(userId) {
    try {
        const params = await ShiftParameters.findOne({
            user: new mongoose.Types.ObjectId(userId)
        });
        return params;
    } catch (err) {
        console.error("Error getting shift parameters:", err);
        throw err;
    }
}

/**
 * Get week boundaries (Monday to Sunday)
 * @param {Date} date - A date within the week
 * @returns {Object} - { start: Date, end: Date }
 */
function getWeekBoundaries(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
}

/**
 * Get day name from date
 * @param {Date} date - The date
 * @returns {string} - Day name in lowercase (monday, tuesday, etc.)
 */
function getDayName(date) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
}

/**
 * Calculate stats for shifts in a given period
 * @param {Array} shifts - Array of shifts
 * @param {Date} now - Current time for active shift calculation
 * @returns {Object} - Stats object
 */
function calculateShiftStats(shifts, now) {
    const stats = {
        remote: { totalSeconds: 0, totalBreakSeconds: 0, netSeconds: 0, shiftCount: 0 },
        office: { totalSeconds: 0, totalBreakSeconds: 0, netSeconds: 0, shiftCount: 0 },
        off: { totalSeconds: 0, totalBreakSeconds: 0, netSeconds: 0, shiftCount: 0 },
        total: { totalSeconds: 0, totalBreakSeconds: 0, netSeconds: 0, shiftCount: 0 }
    };

    for (const shift of shifts) {
        const type = shift.type;
        if (!stats[type]) continue; // Skip unknown types

        const endTime = shift.active ? now : new Date(shift.endedAt);
        const startTime = new Date(shift.startedAt);

        const totalSeconds = Math.floor((endTime - startTime) / 1000);

        let breakSeconds = shift.breakDurationSeconds || 0;
        if (shift.active && shift.breakStartedAt && !shift.breakEndedAt) {
            breakSeconds += Math.floor((now - new Date(shift.breakStartedAt)) / 1000);
        }

        const netSeconds = totalSeconds - breakSeconds;

        stats[type].totalSeconds += totalSeconds;
        stats[type].totalBreakSeconds += breakSeconds;
        stats[type].netSeconds += netSeconds;
        stats[type].shiftCount += 1;

        // Only count remote and office in total (not off)
        if (type !== 'off') {
            stats.total.totalSeconds += totalSeconds;
            stats.total.totalBreakSeconds += breakSeconds;
            stats.total.netSeconds += netSeconds;
            stats.total.shiftCount += 1;
        }
    }

    return stats;
}

/**
 * Get schedule for current and previous week with projections
 * @param {string} userId - The ID of the user
 * @returns {Promise<Object>} - Schedule with current and expected values
 */
async function getSchedule(userId) {
    try {
        const now = new Date();
        const currentWeek = getWeekBoundaries(now);
        const previousWeekDate = new Date(currentWeek.start);
        previousWeekDate.setDate(previousWeekDate.getDate() - 7);
        const previousWeek = getWeekBoundaries(previousWeekDate);

        // Get user's shift parameters
        const params = await getShiftParameters(userId);

        // Default parameters if not set
        const netWorkTimeMinimumSeconds = params?.netWorkTimeMinimumSeconds || 25200; // 7 hours
        const breakDurationMinimumSeconds = params?.breakDurationMinimumSeconds || 3600; // 1 hour
        const weekSchedule = params?.weekSchedule || {
            monday: 'office',
            tuesday: 'office',
            wednesday: 'remote',
            thursday: 'office',
            friday: 'remote',
            saturday: 'off',
            sunday: 'off'
        };

        // Get shifts for both weeks
        const shifts = await Shift.find({
            user: new mongoose.Types.ObjectId(userId),
            startedAt: { $gte: previousWeek.start, $lte: currentWeek.end }
        });

        const currentWeekShifts = shifts.filter(s =>
            new Date(s.startedAt) >= currentWeek.start && new Date(s.startedAt) <= currentWeek.end
        );
        const previousWeekShifts = shifts.filter(s =>
            new Date(s.startedAt) >= previousWeek.start && new Date(s.startedAt) <= previousWeek.end
        );

        // Calculate current stats
        const currentWeekStats = calculateShiftStats(currentWeekShifts, now);
        const previousWeekStats = calculateShiftStats(previousWeekShifts, now);

        // Calculate expected values for current week
        // For past days (before today): use actual values
        // For today and future days: project using parameters

        let expectedNetSeconds = 0;
        let expectedBreakSeconds = 0;
        let expectedRemoteShifts = 0;
        let expectedOfficeShifts = 0;
        let expectedTotalWorkDays = 0;

        // Iterate through each day of current week
        const dayIterator = new Date(currentWeek.start);
        while (dayIterator <= currentWeek.end) {
            const dayName = getDayName(dayIterator);
            const scheduleType = weekSchedule[dayName];

            if (scheduleType !== 'off') {
                expectedNetSeconds += netWorkTimeMinimumSeconds;
                expectedBreakSeconds += breakDurationMinimumSeconds;
                expectedTotalWorkDays += 1;

                if (scheduleType === 'remote') {
                    expectedRemoteShifts += 1;
                } else if (scheduleType === 'office') {
                    expectedOfficeShifts += 1;
                }
            }

            dayIterator.setDate(dayIterator.getDate() + 1);
        }

        // Helper function to format time
        const formatTime = (seconds) => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            return {
                hours,
                minutes,
                seconds: secs,
                formatted: `${hours}h ${minutes}m ${secs}s`
            };
        };

        // Helper function to get percentage
        const getPercentage = (numerator, denominator) => {
            if (denominator === 0) return null;
            return Math.round((numerator / denominator) * 10000) / 100;
        };

        // Calculate current remote percentage
        const currentRemotePercent = getPercentage(
            currentWeekStats.remote.netSeconds,
            currentWeekStats.remote.netSeconds + currentWeekStats.office.netSeconds
        );

        // Calculate expected remote percentage
        const expectedRemotePercent = getPercentage(
            expectedRemoteShifts,
            expectedRemoteShifts + expectedOfficeShifts
        );

        // Previous week remote percentage
        const previousRemotePercent = getPercentage(
            previousWeekStats.remote.netSeconds,
            previousWeekStats.remote.netSeconds + previousWeekStats.office.netSeconds
        );

        return {
            currentWeek: {
                start: currentWeek.start,
                end: currentWeek.end,
                current: {
                    totalHours: formatTime(currentWeekStats.total.totalSeconds),
                    netHours: formatTime(currentWeekStats.total.netSeconds),
                    breakHours: formatTime(currentWeekStats.total.totalBreakSeconds),
                    remotePercent: currentRemotePercent,
                    shiftCount: currentWeekStats.total.shiftCount,
                    remote: {
                        netSeconds: currentWeekStats.remote.netSeconds,
                        netTime: formatTime(currentWeekStats.remote.netSeconds),
                        shiftCount: currentWeekStats.remote.shiftCount
                    },
                    office: {
                        netSeconds: currentWeekStats.office.netSeconds,
                        netTime: formatTime(currentWeekStats.office.netSeconds),
                        shiftCount: currentWeekStats.office.shiftCount
                    }
                },
                expected: {
                    netHours: formatTime(expectedNetSeconds),
                    breakHours: formatTime(expectedBreakSeconds),
                    remotePercent: expectedRemotePercent,
                    workDays: expectedTotalWorkDays,
                    remoteShifts: expectedRemoteShifts,
                    officeShifts: expectedOfficeShifts
                },
                progress: {
                    hoursPercent: getPercentage(currentWeekStats.total.netSeconds, expectedNetSeconds),
                    shiftsPercent: getPercentage(currentWeekStats.total.shiftCount, expectedTotalWorkDays)
                }
            },
            previousWeek: {
                start: previousWeek.start,
                end: previousWeek.end,
                totalHours: formatTime(previousWeekStats.total.totalSeconds),
                netHours: formatTime(previousWeekStats.total.netSeconds),
                breakHours: formatTime(previousWeekStats.total.totalBreakSeconds),
                remotePercent: previousRemotePercent,
                shiftCount: previousWeekStats.total.shiftCount,
                remote: {
                    netSeconds: previousWeekStats.remote.netSeconds,
                    netTime: formatTime(previousWeekStats.remote.netSeconds),
                    shiftCount: previousWeekStats.remote.shiftCount
                },
                office: {
                    netSeconds: previousWeekStats.office.netSeconds,
                    netTime: formatTime(previousWeekStats.office.netSeconds),
                    shiftCount: previousWeekStats.office.shiftCount
                }
            },
            parameters: {
                netWorkTimeMinimumSeconds,
                breakDurationMinimumSeconds,
                weekSchedule
            }
        };
    } catch (err) {
        console.error("Error getting schedule:", err);
        throw err;
    }
}

module.exports = {
    createShift,
    breakStart,
    breakStop,
    getActiveShift,
    getAllShifts,
    updateShift,
    deleteShift,
    endShift,
    getStats,
    createOrUpdateShiftParameters,
    getShiftParameters,
    getSchedule
};

