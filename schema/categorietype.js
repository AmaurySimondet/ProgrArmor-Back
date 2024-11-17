const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the CategorieType schema
const categorieTypeSchema = new Schema(
    {
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        examples: {
            fr: [{ type: String }],
            en: [{ type: String }]
        },
        popularityScore: { type: Number, default: 0 }
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
    }
);

// Create and export the model
module.exports = mongoose.model("CategorieType", categorieTypeSchema);
