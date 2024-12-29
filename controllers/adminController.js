const { getRouteStats } = require('../utils/timing');

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/admin/route-stats', getRouteStats);

    // Add more admin routes here as needed
}; 