const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Embedding schema
const embeddingSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, required: true, auto: true },
        search: { type: String, required: true, unique: true, index: true },
        embedding: { type: [Number], required: false },
        model: { type: String, required: true, default: 'intfloat/multilingual-e5-large' },
        usageCount: { type: Number, default: 0 },
        lastUsed: { type: Date, required: false }
    },
    {
        timestamps: true
    }
);

// Create and export the model
module.exports = mongoose.model("Embedding", embeddingSchema); 