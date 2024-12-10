const mongoose = require('mongoose');

const awsImageSchema = new mongoose.Schema({
    user: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    key: {
        type: String,
        required: true
    },
    bucket: {
        type: String,
        required: true
    },
    distribution: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    cloudfrontUrl: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true // Automatically adds createdAt and updatedAt fields
});

const AwsImage = mongoose.model('AwsImage', awsImageSchema);

module.exports = AwsImage; 