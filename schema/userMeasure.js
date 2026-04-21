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
        heightMultiplier: {
            type: Number,
            min: 0,
            default: 1
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

function computeHeightMultiplier(heightCm) {
    const h = Number(heightCm);
    if (!Number.isFinite(h) || h <= 0) return 1;
    return Math.round((((h / 170) ** 2) + Number.EPSILON) * 1000000) / 1000000;
}

userMeasureSchema.pre("validate", function setHeightMultiplier(next) {
    this.heightMultiplier = computeHeightMultiplier(this?.height?.cm);
    next();
});

module.exports = mongoose.model("UserMeasure", userMeasureSchema);
