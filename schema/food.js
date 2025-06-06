const mongoose = require('mongoose');

const FoodSchema = new mongoose.Schema({
    foodId: { type: String, required: true, unique: true },
    brandName: String,
    foodName: { type: String, required: true },
    foodDescription: String,
    foodType: String,
    foodUrl: String,
    calories: Number,
    fat: Number,
    carbs: Number,
    protein: Number,
    lastUpdated: { type: Date, default: Date.now }
}, {
    timestamps: true
});

module.exports = mongoose.model('Food', FoodSchema); 