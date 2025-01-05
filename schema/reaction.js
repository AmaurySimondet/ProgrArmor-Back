const mongoose = require('mongoose');
const { Schema } = mongoose;

const reactionSchema = new Schema({
    seance: { type: Schema.Types.ObjectId, ref: 'Seance', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    comment: { type: Schema.Types.ObjectId, ref: 'SeanceComment', required: true, default: null },
    reaction: {
        type: String,
        required: true,
        enum: ['👍', '❤️', '💪', '👏', '😂']
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Reaction', reactionSchema); 