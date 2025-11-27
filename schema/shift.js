const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Shift schema
const shiftSchema = new Schema(
    {
        type: { type: String, required: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        active: { type: Boolean, required: true },
        startedAt: { type: Date, required: true },
        endedAt: { type: Date, required: true },
        breakStartedAt: { type: Date, required: false },
        breakEndedAt: { type: Date, required: false },
        breakDurationSeconds: { type: Number, required: false },
    },
    {
        timestamps: true
    }
);

// Create and export the model
module.exports = mongoose.model("Shift", shiftSchema);
