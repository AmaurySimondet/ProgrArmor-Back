const mongoose = require("mongoose");
const { Schema } = mongoose;

const coachingSpecialtySchema = new Schema(
    {
        _id: Schema.Types.ObjectId,
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        normalizedName: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        description: {
            fr: { type: String },
            en: { type: String }
        },
        icon: { type: String },
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("CoachingSpecialty", coachingSpecialtySchema); 