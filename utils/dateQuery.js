function buildRegularityDateQuery(dateMin, dateMax) {
    if (!dateMin && !dateMax) return {};
    const range = {};
    if (dateMin) {
        const min = new Date(dateMin);
        if (Number.isFinite(min.getTime())) {
            min.setHours(0, 0, 0, 0);
            range.$gte = min;
        }
    }
    if (dateMax) {
        const max = new Date(dateMax);
        if (Number.isFinite(max.getTime())) {
            max.setHours(23, 59, 59, 999);
            range.$lte = max;
        }
    }
    return Object.keys(range).length > 0 ? range : {};
}

module.exports = { buildRegularityDateQuery };
