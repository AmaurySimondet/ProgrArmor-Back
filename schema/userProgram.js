const mongoose = require("mongoose");
const { Schema } = mongoose;

const programExerciseSetSchema = new Schema(
    {
        unit: { type: String, required: true },
        value: { type: Number, required: true },
        weightLoad: { type: Number, required: false },
        elastic: {
            type: { type: String, required: false },
            use: { type: String, required: false },
            tension: { type: Number, required: false },
        },
        isUnilateral: { type: Boolean, default: false },
        unilateralSide: { type: String, enum: ['left', 'right'], required: false },
    },
    { _id: false }
);

const programExerciseSchema = new Schema(
    {
        variationIds: [{ type: Schema.Types.ObjectId, ref: 'Variation', required: true }],
        variationName: {
            fr: { type: String, required: false },
            en: { type: String, required: false },
        },
        mergedVariationsNames: {
            fr: { type: String, required: false },
            en: { type: String, required: false },
        },
        sets: { type: [programExerciseSetSchema], default: [] },
    },
    { _id: false }
);

const userProgramSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        initials: { type: String, required: true, trim: true, maxlength: 3 },
        color: { type: String, required: true },
        folder: { type: Schema.Types.ObjectId, ref: 'ProgramFolder', required: false, default: null },
        program: { type: [programExerciseSchema], default: [] },
        sourceExampleId: { type: String, required: false, trim: true, default: null },
        isArchived: { type: Boolean, default: false },
        lastSeanceId: { type: Schema.Types.ObjectId, ref: 'Seance', required: false, default: null },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    }
);

userProgramSchema.index({ user: 1, initials: 1 }, { unique: true });
userProgramSchema.index({ user: 1, isArchived: 1 });
userProgramSchema.index({ user: 1, folder: 1 });
userProgramSchema.index(
    { user: 1, sourceExampleId: 1 },
    { unique: true, sparse: true }
);

module.exports = mongoose.model("UserProgram", userProgramSchema);
