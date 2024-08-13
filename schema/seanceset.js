const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Seance schema
const seancesetSchema = new Schema(
    {
        _id: Schema.Types.ObjectId,
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        exercice: { type: Schema.Types.ObjectId, ref: 'Exercise', required: true },
        exerciceType: { type: Schema.Types.ObjectId, ref: 'ExerciseType', required: true },
        categories: Array,
        seance: { type: Schema.Types.ObjectId, ref: 'Seance', required: true },
        exerciceOrder: Number,
        exerciceTotal: Number,
        setOrder: Number,
        setTotal: Number,
        unit: String,
        weightLoad: Number,
        value: Number,
        elastic: {
            use: String,
            tension: Number
        },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
    }
);

// Create and export the model
module.exports = mongoose.model("Seanceset", seancesetSchema);
