const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Seance schema
const seanceSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, required: true, auto: true },
        name: { type: String, required: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        title: { type: String, required: true },
        description: { type: String, required: false },
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
        ],
        seancePhotos: [{ type: String, required: false }]
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
    }
);

seanceSchema.index({ user: 1, date: -1 }); // Compound index
seanceSchema.index({ date: -1 });

// Create and export the model
module.exports = mongoose.model("Seance", seanceSchema);
