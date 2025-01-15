const mongoose = require('mongoose');

const weatherSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    location: {
        lat: Number,
        lon: Number
    },
    weatherData: {
        current: {
            temp: Number,
            description: String,
            description_fr: String,
            icon: String,
            label: String
        },
        tomorrow: {
            temp: Number,
            description: String,
            description_fr: String,
            icon: String,
            label: String
        },
        dayAfter: {
            temp: Number,
            description: String,
            description_fr: String,
            icon: String,
            label: String
        },
        city: String
    },
    date: { type: Date, default: Date.now },
}, {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
});

weatherSchema.index({ 'location.lat': 1, 'location.lon': 1, 'date': 1 });

module.exports = mongoose.model('Weather', weatherSchema); 