const weather = require('../lib/weather');

module.exports = (router) => {
    router.get('/weather', async (req, res) => {
        try {
            const { lat, lon, userId } = req.query;
            const weatherFetch = await weather.getWeather(lat, lon, userId);
            res.json(weatherFetch);
        } catch (error) {
            console.error('Weather fetch error:', error);
            res.status(500).json({ error: 'Failed to fetch weather data' });
        }
    });
}; 