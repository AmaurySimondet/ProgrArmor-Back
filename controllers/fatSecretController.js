const fatSecret = require('../lib/fatSecret');

module.exports = function (app) {
    // Search foods
    app.get('/fatsecret/foods/search', async (req, res) => {
        try {
            const { query, page = 0 } = req.query;

            if (!query) {
                return res.status(400).json({
                    success: false,
                    message: 'Search query is required'
                });
            }

            const results = await fatSecret.searchFoods(query, page);
            res.json({
                success: true,
                data: results
            });
        } catch (error) {
            console.error('FatSecret API error:', error);
            res.status(500).json({
                success: false,
                message: 'Error searching foods',
                error: error.message
            });
        }
    });
}; 