const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Type schema
const typeSchema = new Schema(
    {
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        normalizedName: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        examples: {
            fr: [{ type: String }],
            en: [{ type: String }]
        },
        popularityScore: { type: Number, default: 0 },
    },
    {
        timestamps: true
    }
);

// Create and export the model
module.exports = mongoose.model("Type", typeSchema);
