const Weather = require('../schema/weather');
const weatherEnum = require('../data/weatherEnum');
const axios = require('axios');
const { getOrSetCache } = require('../utils/cache');

const formatWeatherData = (weatherData) => ({
    temp: Math.round(weatherData.main.temp),
    description: weatherData.weather[0].description,
    description_fr: weatherEnum[weatherData.weather[0].icon]?.description_fr,
    icon: weatherEnum[weatherData.weather[0].icon]?.url,
    label: weatherData.weather[0].icon
});

// Save to database
const _upsertWeather = async (lat, lon, userId, weatherData) => await Weather.findOneAndUpdate(
    {
        'location.lat': lat, 'location.lon': lon, 'user': userId,
        'date': {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lte: new Date(new Date().setHours(23, 59, 59, 999))
        }
    },
    {
        location: { lat, lon },
        weatherData: weatherData,
        date: new Date()
    },
    { upsert: true, new: true }
);

/**
 * Get weather data for a given location from cache, DB or OpenWeather API
 * @param {number} lat - Latitude of the location
 * @param {number} lon - Longitude of the location
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Weather data
 */
const getWeather = async (lat, lon, userId) => {
    // round lat and lon to 4 decimal places
    lat = Math.round(lat * 100) / 100;
    lon = Math.round(lon * 100) / 100;

    const cacheKey = `weather_${lat}_${lon}`;

    return await getOrSetCache(cacheKey, async () => {
        // Check cache in database
        const cachedWeather = await Weather.findOne({
            'location.lat': lat,
            'location.lon': lon,
            'date': {
                $gte: new Date(new Date().setHours(0, 0, 0, 0)), // Start of today
                $lte: new Date(new Date().setHours(23, 59, 59, 999)) // End of today
            }
        });

        if (cachedWeather) {
            await _upsertWeather(lat, lon, userId, cachedWeather.weatherData);
            return cachedWeather.weatherData;
        }

        // Fetch new data if cache miss
        const API_KEY = process.env.OPENWEATHER_API_KEY;
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
        );

        const processedData = {
            current: formatWeatherData(response.data.list[0]),
            tomorrow: formatWeatherData(response.data.list[8]),
            dayAfter: formatWeatherData(response.data.list[16]),
            city: response.data.city.name
        };

        await _upsertWeather(lat, lon, userId, processedData);

        return processedData;
    });
};

module.exports = { getWeather };