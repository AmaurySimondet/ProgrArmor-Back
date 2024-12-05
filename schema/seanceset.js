const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Seance schema
const seancesetSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, required: true, auto: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        exercice: { type: Schema.Types.ObjectId, ref: 'Exercise', required: true },
        exerciceType: { type: Schema.Types.ObjectId, ref: 'ExerciseType', required: true },
        categories: [
            {
                category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
                categoryType: { type: Schema.Types.ObjectId, ref: 'CategoryType', required: true },
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
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
    }
);

// Create and export the model
module.exports = mongoose.model("Seanceset", seancesetSchema);
