const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Megatype schema
const megatypeSchema = new Schema(
    {
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        popularityScore: { type: Number, default: 0 },
    },
    {
        timestamps: true
    }
);

// Create and export the model
module.exports = mongoose.model("Megatype", megatypeSchema);
