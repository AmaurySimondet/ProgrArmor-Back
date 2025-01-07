const { getInscriptionInfo } = require('../utils/admin');
const { getRouteStats } = require('../utils/timing');

module.exports = (router) => {
    // Route statistics endpoint
    router.get('/admin/route-stats', getRouteStats);

    router.get('/admin/inscription', getInscriptionInfo);

    // Add more admin routes here as needed
}; 