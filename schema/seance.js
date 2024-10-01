const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Seance schema
const seanceSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, required: true, auto: true },
        name: { type: String, required: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        title: { type: String, required: true },
        date: { type: Date, required: true },
        stats: {
            nSets: { type: Number, required: true },
            nReps: { type: Number, required: true },
            intervalReps: { type: String, required: true },
            intervalWeight: { type: String, required: true },
            totalWeight: { type: Number, required: true },
        },
        recordSummary: [
            { PR: { type: String, required: true }, number: { type: Number, required: true } }
        ]
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
    }
);

// Create and export the model
module.exports = mongoose.model("Seance", seanceSchema);
