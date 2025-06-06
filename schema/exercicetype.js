const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the ExerciceType schema
const exerciceTypeSchema = new Schema(
    {
        _id: Schema.Types.ObjectId,
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        examples: {
            fr: [{ type: String }],
            en: [{ type: String }]
        },
        popularityScore: { type: Number, required: true, default: 0 },
        normalizedName: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        }
    },
    {
        timestamps: true
    }
);

// Create and export the model
module.exports = mongoose.model("ExerciceType", exerciceTypeSchema);
