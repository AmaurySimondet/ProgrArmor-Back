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
        },
        normalizedName: {
            fr: { type: String, required: true },
            en: { type: String, required: true }
        }
    },
    {
        timestamps: true
    }
);

categorieSchema.index({ type: 1 });
categorieSchema.index({ 'normalizedName.fr': 1 });

module.exports = mongoose.model("Categorie", categorieSchema);
