const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the Seance schema
const seancesetSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, required: true, auto: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        exercice: { type: Schema.Types.ObjectId, ref: 'Exercise', required: false },
        exerciceType: { type: Schema.Types.ObjectId, ref: 'ExerciseType', required: false },
        categories: [
            {
                category: { type: Schema.Types.ObjectId, ref: 'Category', required: false },
                categoryType: { type: Schema.Types.ObjectId, ref: 'CategoryType', required: false },
            }
        ],
        seance: { type: Schema.Types.ObjectId, ref: 'Seance', required: true },
        exerciceOrder: { type: Number, required: true },
        exerciceTotal: { type: Number, required: true },
        setOrder: { type: Number, required: true },
        setTotal: { type: Number, required: true },
        unit: { type: String, required: true },
        weightLoad: { type: Number, required: true },
        value: { type: Number, required: true },
        isUnilateral: { type: Boolean, default: false },
        unilateralSide: { type: String, enum: ['left', 'right'], default: undefined },
        elastic: {
            use: String,
            tension: Number
        },
        PR: { type: String, default: null },
        date: { type: Date, required: true },
        variations: [
            {
                variation: { type: Schema.Types.ObjectId, ref: 'Variation', required: true },
                type: { type: Schema.Types.ObjectId, ref: 'Type', required: true },
                name: {
                    fr: { type: String, required: false },
                    en: { type: String, required: false }
                },
            }
        ],
        mergedVariationsNames: {
            fr: { type: String, required: false },
            en: { type: String, required: false }
        },
        rpe: { type: Number, required: false },
        brzycki: { type: Number, default: null },
        epley: { type: Number, default: null },
        oneRepMaxIncludesBodyweight: { type: Boolean, default: false },
        oneRepMaxUserWeightKg: { type: Number, default: null },
        oneRepMaxExerciseBodyWeightRatio: { type: Number, default: null },
        brzyckiWithBodyweight: { type: Number, default: null },
        epleyWithBodyweight: { type: Number, default: null },
        /** Charge effective (kg), ex. barre + élastique signé — optionnel, fourni par l’app ou backfill */
        effectiveWeightLoad: { type: Number, default: null },
        effectiveWeightLoadWithBodyweight: { type: Number, default: null },
        weightLoadLbs: { type: Number, default: null },
        effectiveWeightLoadLbs: { type: Number, default: null },
        effectiveWeightLoadWithBodyweightLbs: { type: Number, default: null },
        validated: { type: String, enum: ['undone', 'pending', 'done'], default: 'undone' },
        breakTime: { type: Number, min: 0, default: null },
        prDetail: { type: Object, default: null },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt", date: "date" }
    }
);

seancesetSchema.index({ user: 1, date: 1 });
seancesetSchema.index({ seance: 1 });
seancesetSchema.index({ user: 1, 'variations.variation': 1, unit: 1 });
seancesetSchema.index({ user: 1, PR: 1 });

module.exports = mongoose.model("Seanceset", seancesetSchema);
