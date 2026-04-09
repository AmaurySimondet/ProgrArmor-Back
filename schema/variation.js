const mongoose = require("mongoose");
const { Schema } = mongoose;

const UPPER_BODY_MUSCLES = [
    "chest",
    "upper_back",
    "lats",
    "traps",
    "neck",
    "deltoids_front",
    "deltoids_side",
    "deltoids_rear",
    "biceps",
    "triceps",
    "forearms",
    "abs",
    "obliques",
    "spinal_erectors"
];

const LOWER_BODY_MUSCLES = [
    "glutes",
    "hamstrings",
    "quads",
    "adductors",
    "abductors",
    "calves"
];

const MUSCLES = [...UPPER_BODY_MUSCLES, ...LOWER_BODY_MUSCLES];

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
        popularity: { type: Number, default: 0 },
        equivalentTo: [{ type: Schema.Types.ObjectId, ref: 'Variation' }],
        verified: { type: Boolean, default: false }
    },
    {
        timestamps: true
    }
);

variationSchema.index({ type: 1, popularity: -1 });

module.exports = mongoose.model("Variation", variationSchema);
