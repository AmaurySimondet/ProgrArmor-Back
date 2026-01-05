const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Seance schema
const seancesetSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, required: true, auto: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        exercice: { type: Schema.Types.ObjectId, ref: 'Exercise', required: false },
        exerciceType: { type: Schema.Types.ObjectId, ref: 'ExerciseType', required: false },
        categories: [
            {
                category: { type: Schema.Types.ObjectId, ref: 'Category', required: false },
                categoryType: { type: Schema.Types.ObjectId, ref: 'CategoryType', required: false },
            }
        ],
        seance: { type: Schema.Types.ObjectId, ref: 'Seance', required: true },
        exerciceOrder: { type: Number, required: true },
        exerciceTotal: { type: Number, required: true },
        setOrder: { type: Number, required: true },
        setTotal: { type: Number, required: true },
        unit: { type: String, required: true },
        weightLoad: { type: Number, required: true },
        value: { type: Number, required: true },
        elastic: {
            use: String,
            tension: Number
        },
        PR: { type: String, default: null },
        date: { type: Date, required: true },
        variations: [
            {
                variation: { type: Schema.Types.ObjectId, ref: 'Variation', required: true },
                type: { type: Schema.Types.ObjectId, ref: 'Type', required: true },
                name: {
                    fr: { type: String, required: false },
                    en: { type: String, required: false }
                },
            }
        ],
        mergedVariationsNames: {
            fr: { type: String, required: false },
            en: { type: String, required: false }
        },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
    }
);

// Create and export the model
module.exports = mongoose.model("Seanceset", seancesetSchema);
