const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Categorie schema
const exerciceSchema = new Schema(
    {
        _id: Schema.Types.ObjectId,
        type: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ExerciceType',
            required: true
        },
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

// Create and export the model
module.exports = mongoose.model("Exercice", exerciceSchema);
