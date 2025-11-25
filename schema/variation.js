const mongoose = require("mongoose");
const { Schema } = mongoose;

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

// Create and export the model
module.exports = mongoose.model("Variation", variationSchema);
