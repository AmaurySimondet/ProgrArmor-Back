const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Shift schema
const shiftParametersSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        breakDurationMinimumSeconds: { type: Number, required: true },
        netWorkTimeMinimumSeconds: { type: Number, required: true },
        weekSchedule: {
            monday: { type: String, required: true, enum: ['office', 'remote', 'off'] },
            tuesday: { type: String, required: true, enum: ['office', 'remote', 'off'] },
            wednesday: { type: String, required: true, enum: ['office', 'remote', 'off'] },
            thursday: { type: String, required: true, enum: ['office', 'remote', 'off'] },
            friday: { type: String, required: true, enum: ['office', 'remote', 'off'] },
            saturday: { type: String, required: true, enum: ['office', 'remote', 'off'] },
            sunday: { type: String, required: true, enum: ['office', 'remote', 'off'] },
        },
    },
    {
        timestamps: true
    }
);

// Create and export the model
module.exports = mongoose.model("ShiftParameters", shiftParametersSchema);
