const mongoose = require("mongoose");
const { Schema } = mongoose;

const feedbackSchema = new Schema(
    {
        type: {
            type: String,
            required: true,
            enum: ['bug', 'feature', 'amélioration', 'autre']
        },
        text: {
            type: String,
            required: true
        },
        media: {
            type: Array,
            default: []
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        status: {
            type: String,
            enum: ['pending', 'in_progress', 'resolved', 'rejected'],
            default: 'pending'
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Feedback", feedbackSchema); 