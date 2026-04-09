const { week: { ONE_DAY_MS, ONE_WEEK_MS, UTC_MONDAY_EPOCH_MS } } = require('../constants');

function getWeekIndex(date) {
    const utcMidnightMs = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
    const dayOfWeekFromMonday = (date.getUTCDay() + 6) % 7; // Monday=0 ... Sunday=6
    const weekStartMondayMs = utcMidnightMs - (dayOfWeekFromMonday * ONE_DAY_MS);
    return Math.floor((weekStartMondayMs - UTC_MONDAY_EPOCH_MS) / ONE_WEEK_MS);
}

function computeCurrentWeekStreak(seances) {
    if (!Array.isArray(seances) || seances.length === 0) return 0;

    const weekIndexes = seances.map((s) => {
        const date = new Date(s?.date);
        const isValidDate = Number.isFinite(date.getTime());
        if (!isValidDate) return NaN;
        return getWeekIndex(date);
    });

    const uniqueWeeks = [...new Set(weekIndexes.filter(Number.isFinite))].sort((a, b) => a - b);
    const currentWeekIndex = getWeekIndex(new Date());
    const lastWorkoutWeek = uniqueWeeks[uniqueWeeks.length - 1];
    if (!Number.isFinite(lastWorkoutWeek)) return 0;
    if (lastWorkoutWeek < currentWeekIndex - 1) return 0;

    let currentStreak = 1;
    for (let i = uniqueWeeks.length - 2; i >= 0; i--) {
        const expectedPreviousWeek = uniqueWeeks[i + 1] - 1;
        const isConsecutive = uniqueWeeks[i] === expectedPreviousWeek;

        if (isConsecutive) currentStreak += 1;
        else break;
    }

    return currentStreak;
}

module.exports = {
    getWeekIndex,
    computeCurrentWeekStreak,
};
