const mongoose = require("mongoose");
const { Schema } = mongoose;

const userSuccessSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        success: { type: Schema.Types.ObjectId, ref: "Success", required: true },
        acknowledged: { type: Boolean, default: false },
        usedOnProfile: { type: Boolean, default: false },
        /** Détails au moment du déblocage (set déclencheur, métriques exactes, etc.) */
        unlockDetail: { type: Schema.Types.Mixed, required: false },
    },
    { timestamps: true }
);

userSuccessSchema.index({ user: 1, success: 1 }, { unique: true });
userSuccessSchema.index({ user: 1, acknowledged: 1, createdAt: -1 });
userSuccessSchema.index({ success: 1 });

module.exports = mongoose.model("UserSuccess", userSuccessSchema);
