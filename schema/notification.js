const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema(
    {
        type: {
            type: String,
            required: true,
            enum: ['follow', 'like', 'comment'] // Add more types as needed
        },
        fromUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        forUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        read: {
            type: Boolean,
            default: false
        },
        // Optional reference fields based on notification type
        programme: { type: Schema.Types.ObjectId, ref: 'Programme' },
        comment: { type: Schema.Types.ObjectId, ref: 'Comment' },
        seance: { type: Schema.Types.ObjectId, ref: 'Seance' }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema); 