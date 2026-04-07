const mongoose = require("mongoose");

const positiveNumberValidator = {
    validator: function (value) {
        return value === undefined || (typeof value === "number" && value > 0);
    },
    message: "Value must be a positive number"
};

const userMeasureSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        measuredAt: {
            type: Date,
            required: true,
            index: true
        },
        height: {
            cm: { type: Number, required: true, validate: positiveNumberValidator },
            ft: { type: Number, required: true, validate: positiveNumberValidator }
        },
        weight: {
            kg: { type: Number, required: true, validate: positiveNumberValidator },
            lb: { type: Number, required: true, validate: positiveNumberValidator }
        },
        bodyFatPct: {
            type: Number,
            validate: positiveNumberValidator
        },
        circumferences: {
            cm: {
                neck: { type: Number, validate: positiveNumberValidator },
                shoulders: { type: Number, validate: positiveNumberValidator },
                chest: { type: Number, validate: positiveNumberValidator },
                waist: { type: Number, validate: positiveNumberValidator },
                hips: { type: Number, validate: positiveNumberValidator },
                leftBiceps: { type: Number, validate: positiveNumberValidator },
                rightBiceps: { type: Number, validate: positiveNumberValidator },
                leftForearm: { type: Number, validate: positiveNumberValidator },
                rightForearm: { type: Number, validate: positiveNumberValidator },
                leftThigh: { type: Number, validate: positiveNumberValidator },
                rightThigh: { type: Number, validate: positiveNumberValidator },
                leftCalf: { type: Number, validate: positiveNumberValidator },
                rightCalf: { type: Number, validate: positiveNumberValidator }
            },
            in: {
                neck: { type: Number, validate: positiveNumberValidator },
                shoulders: { type: Number, validate: positiveNumberValidator },
                chest: { type: Number, validate: positiveNumberValidator },
                waist: { type: Number, validate: positiveNumberValidator },
                hips: { type: Number, validate: positiveNumberValidator },
                leftBiceps: { type: Number, validate: positiveNumberValidator },
                rightBiceps: { type: Number, validate: positiveNumberValidator },
                leftForearm: { type: Number, validate: positiveNumberValidator },
                rightForearm: { type: Number, validate: positiveNumberValidator },
                leftThigh: { type: Number, validate: positiveNumberValidator },
                rightThigh: { type: Number, validate: positiveNumberValidator },
                leftCalf: { type: Number, validate: positiveNumberValidator },
                rightCalf: { type: Number, validate: positiveNumberValidator }
            }
        }
    },
    { timestamps: true }
);

userMeasureSchema.index({ userId: 1, measuredAt: -1 });

module.exports = mongoose.model("UserMeasure", userMeasureSchema);
