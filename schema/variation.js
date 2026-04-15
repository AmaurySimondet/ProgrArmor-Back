const mongoose = require("mongoose");
const { Schema } = mongoose;
const { schema: { MUSCLES } } = require('../constants');

// Define the Variation schema
const variationSchema = new Schema(
    {
        type: { type: Schema.Types.ObjectId, ref: 'Type', required: true },
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        normalizedName: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        selfmade: { type: Boolean, required: true },
        megatype: { type: Schema.Types.ObjectId, ref: "Megatype" },
        isExercice: { type: Boolean, required: true },
        isUnilateral: { type: Boolean, default: false },
        muscles: {
            primary: [{
                type: String,
                enum: MUSCLES
            }],
            secondary: [{
                type: String,
                enum: MUSCLES
            }]
        },
        weightType: {
            type: String,
            enum: ["bodyweight_plus_external", "external_free", "external_machine"]
        },
        includeBodyweight: { type: Boolean },
        exerciseBodyWeightRatio: { type: Number, min: 0, max: 1.5 },
        mergedNamesEmbedding: { type: [Number], required: false },
        mergedNames: { type: String, required: false },
        picture: { type: String },
        // Backward-compatible: Number for exercise variations, Object for detail contextual popularity
        popularity: { type: Schema.Types.Mixed, default: 0 },
        equivalentTo: [{ type: Schema.Types.ObjectId, ref: 'Variation' }],
        verified: { type: Boolean, default: false }
    },
    {
        timestamps: true
    }
);

variationSchema.index({ type: 1, isExercice: 1, popularity: -1 });
variationSchema.index({ type: 1, isExercice: 1, 'popularity.global': -1 });

module.exports = mongoose.model("Variation", variationSchema);
