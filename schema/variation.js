const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Variation schema
const variationSchema = new Schema(
    {
        _id: Schema.Types.ObjectId,
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
    },
    {
        timestamps: true
    }
);

// Create and export the model
module.exports = mongoose.model("Variation", variationSchema);
