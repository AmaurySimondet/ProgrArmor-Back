const mongoose = require("mongoose");
const { Schema } = mongoose;

const variationProgressionEdgeSchema = new Schema(
    {
        fromVariationId: { type: Schema.Types.ObjectId, ref: "Variation", required: true, index: true },
        fromVariationName: { type: String, default: "" },
        toVariationId: { type: Schema.Types.ObjectId, ref: "Variation", required: true, index: true },
        toVariationName: { type: String, default: "" },
        isExerciseVariation: { type: Boolean, required: true, default: false, index: true },
        difficultyRatio: { type: Number, required: true, min: 0 },
        confidence: {
            type: String,
            enum: ["low", "medium", "high"],
            default: "medium"
        },
        source: {
            type: String,
            enum: ["manual", "data", "hybrid"],
            default: "manual"
        },
        contextVariationId: { type: Schema.Types.ObjectId, ref: "Variation", default: null },
        notes: { type: String, default: "" },
        isActive: { type: Boolean, default: true }
    },
    {
        timestamps: true
    }
);

variationProgressionEdgeSchema.index(
    { fromVariationId: 1, toVariationId: 1, contextVariationId: 1 },
    { unique: true }
);
variationProgressionEdgeSchema.index({ fromVariationId: 1, isActive: 1, difficultyRatio: 1 });
variationProgressionEdgeSchema.index({ toVariationId: 1, isActive: 1, difficultyRatio: 1 });

module.exports = mongoose.model("VariationProgressionEdge", variationProgressionEdgeSchema);
