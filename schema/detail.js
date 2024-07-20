const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Detail schema
const detailSchema = new Schema(
    {
        type: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        },
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        }
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
    }
);

// Create and export the model
module.exports = mongoose.model("Detail", detailSchema);