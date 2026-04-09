const mongoose = require("mongoose");
const { Schema } = mongoose;
const { success: { SUCCESS_TYPES } } = require('../constants');

const successSchema = new Schema(
    {
        type: {
            type: String,
            enum: SUCCESS_TYPES,
            required: true,
        },
        level: {
            type: Number,
            required: true,
            min: 0,
            max: 5,
        },
        name: {
            fr: { type: String, required: true },
            en: { type: String, required: true },
        },
        description: {
            fr: { type: String, required: true },
            en: { type: String, required: true },
        },
        hint: {
            fr: { type: String, required: false, default: "" },
            en: { type: String, required: false, default: "" },
        },
        picture: {
            fr: { type: String, required: false, default: null },
            en: { type: String, required: false, default: null },
        },
        condition: { type: Schema.Types.Mixed, required: true },
        /** Dernière modification des règles de déblocage (condition), indépendante du compteur howManyUsersHaveIt */
        conditionUpdatedAt: { type: Date, required: false },
        howManyUsersHaveIt: { type: Number, default: 0 },
    },
    { timestamps: true }
);

successSchema.pre("save", function (next) {
    if (this.isModified("condition")) {
        this.conditionUpdatedAt = new Date();
    }
    next();
});

successSchema.index({ type: 1, level: 1 });
successSchema.index({ "name.fr": 1, level: 1 });

module.exports = mongoose.model("Success", successSchema);
