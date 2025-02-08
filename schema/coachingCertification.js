const mongoose = require("mongoose");
const { Schema } = mongoose;

const coachingCertificationSchema = new Schema(
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
        type: {
            type: String,
            enum: ['national', 'international'],
            required: true
        },
        level: {
            type: String,
            enum: ['basic', 'intermediate', 'advanced', 'expert'],
            required: true
        },
        category: {
            type: String,
            enum: ['general', 'specialized', 'academic', 'complementary'],
            required: true
        },
        validityPeriod: {
            type: Number,  // in months, 0 for permanent
            default: 0
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("CoachingCertification", coachingCertificationSchema); 