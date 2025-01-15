const mongoose = require('mongoose');
const { Schema } = mongoose;

const seanceCommentSchema = new Schema({
    seance: { type: Schema.Types.ObjectId, ref: 'Seance', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parentComment: { type: Schema.Types.ObjectId, ref: 'SeanceComment', required: false },
    identifiedUsers: [{ type: Schema.Types.ObjectId, ref: 'User', required: false }],
    text: { type: String, required: true },
}, {
    timestamps: true
});

module.exports = mongoose.model('SeanceComment', seanceCommentSchema); 