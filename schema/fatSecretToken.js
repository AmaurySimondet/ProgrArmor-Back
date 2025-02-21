const mongoose = require('mongoose');

const fatSecretTokenSchema = new mongoose.Schema({
    accessToken: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    }
}, {
    timestamps: true
});

const FatSecretToken = mongoose.model('FatSecretToken', fatSecretTokenSchema);

module.exports = FatSecretToken; 