const routeTimings = new Map();

const timingMiddleware = (req, res, next) => {
    const start = process.hrtime();

    // Store original end function
    const originalEnd = res.end;

    // Override end function
    res.end = function (...args) {
        const diff = process.hrtime(start);
        const time = diff[0] * 1000 + diff[1] / 1000000; // Convert to milliseconds

        const route = `${req.method} ${req.originalUrl}`;
        const current = routeTimings.get(route) || [];
        current.push(time);

        // Keep only last 100 requests
        if (current.length > 100) current.shift();
        routeTimings.set(route, current);

        // Log timing
        console.log(`${route}: ${time.toFixed(2)}ms`);

        // Call original end
        originalEnd.apply(this, args);
    };

    next();
};

// Endpoint to get route statistics
const getRouteStats = (req, res) => {
    const stats = {};

    for (const [route, timings] of routeTimings.entries()) {
        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        const max = Math.max(...timings);
        const min = Math.min(...timings);

        stats[route] = {
            avg: avg.toFixed(2),
            max: max.toFixed(2),
            min: min.toFixed(2),
            count: timings.length
        };
    }

    res.json(stats);
};

module.exports = { timingMiddleware, getRouteStats }; 