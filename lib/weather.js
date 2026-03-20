const Weather = require('../schema/weather');
const weatherEnum = require('../data/weatherEnum');
const axios = require('axios');

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
    // Ensure lat/lon are numbers and round to 2 decimal places
    lat = +Number(lat).toFixed(2);
    lon = +Number(lon).toFixed(2);

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const cachedWeather = await Weather.findOne({
        'location.lat': lat,
        'location.lon': lon,
        'date': { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    if (cachedWeather) {
        _upsertWeather(lat, lon, userId, cachedWeather.weatherData);
        return cachedWeather.weatherData;
    }

    const API_KEY = process.env.OPENWEATHER_API_KEY;
    const { data } = await axios.get(
        `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
    );

    const processedData = {
        current: formatWeatherData(data.list[0]),
        tomorrow: formatWeatherData(data.list[8]),
        dayAfter: formatWeatherData(data.list[16]),
        city: data.city.name
    };

    _upsertWeather(lat, lon, userId, processedData);

    return processedData;
};

module.exports = { getWeather };