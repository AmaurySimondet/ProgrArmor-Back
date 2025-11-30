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
        required: false
    },
    location: {
        type: String,
        required: false
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
    },
    seanceDate: {
        type: Date,
        required: false
    },
    seanceName: {
        type: String,
        required: false
    },
    seanceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Seance',
        required: false
    }
}, {
    timestamps: true // Automatically adds createdAt and updatedAt fields
});

const AwsImage = mongoose.model('AwsImage', awsImageSchema);

module.exports = AwsImage; 