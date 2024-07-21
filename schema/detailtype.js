const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the DetailType schema
const detailTypeSchema = new Schema(
    {
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        examples: {
            fr: [{ type: String }],
            en: [{ type: String }]
        }
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
    }
);

// Create and export the model
module.exports = mongoose.model("DetailType", detailTypeSchema);
