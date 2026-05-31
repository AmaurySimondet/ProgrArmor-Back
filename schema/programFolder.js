const mongoose = require("mongoose");
const { Schema } = mongoose;

const programFolderSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        initials: { type: String, required: true, trim: true, maxlength: 3 },
        color: { type: String, required: true },
    },
    {
        timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    }
);

programFolderSchema.index({ user: 1, initials: 1 }, { unique: true });

module.exports = mongoose.model("ProgramFolder", programFolderSchema);
