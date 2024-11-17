const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Categorie schema
const categorieSchema = new Schema(
    {
        _id: Schema.Types.ObjectId,
        type: { type: Schema.Types.ObjectId, ref: 'CategorieType', required: true },
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
module.exports = mongoose.model("Categorie", categorieSchema);
