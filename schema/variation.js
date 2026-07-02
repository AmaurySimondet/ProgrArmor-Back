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
        madeByUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
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
        progressionReferenceVariationId: { type: Schema.Types.ObjectId, ref: 'Variation', default: null },
        verified: { type: Boolean, default: false },
        defaultMode: {
            type: String,
            enum: ['repetitions', 'seconds', 'cardio'],
            default: 'repetitions',
        },
        /** @deprecated Plus utilisé pour le gate stats/timeseries ; conservé pour rétrocompat admin. */
        possibleProgression: { type: Boolean, default: true }
    },
    {
        timestamps: true
    }
);

variationSchema.index({ type: 1, isExercice: 1, popularity: -1 });
variationSchema.index({ type: 1, isExercice: 1, 'popularity.global': -1 });
variationSchema.index({ selfmade: 1, madeByUser: 1 });
variationSchema.index({ isExercice: 1, 'normalizedName.fr': 1 });
variationSchema.index({ isExercice: 1, 'normalizedName.en': 1 });
variationSchema.index({ 'muscles.primary': 1 });
variationSchema.index({ 'muscles.secondary': 1 });

module.exports = mongoose.model("Variation", variationSchema);
