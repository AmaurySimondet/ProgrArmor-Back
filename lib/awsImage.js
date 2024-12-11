const AWS = require('aws-sdk');
const fs = require('fs');
const AwsImage = require('../schema/awsImage');
const { invalidateCacheStartingWith } = require('../controllers/utils/cache');
require('dotenv').config();
const mongoose = require('mongoose');
const User = require("../schema/schemaUser.js");

// Configure AWS
AWS.config.update({
    region: 'eu-west-3',
    credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    })
});

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

// Simplified checkDistributionStatus function
async function checkDistributionStatus() {
    const params = {
        Id: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID
    };
    return await cloudfront.getDistribution(params).promise();
}

async function uploadImage(userId, file) {
    try {
        await checkDistributionStatus();

        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${userId}-${Date.now()}.${file.originalname.split('.').pop()}`,
            Body: file.buffer,
            ContentType: file.mimetype,
            Metadata: {
                'Access-Control-Allow-Origin': '*'
            },
            CacheControl: 'max-age=31536000'
        };

        const uploadResult = await s3.upload(params).promise();

        const invalidationParams = {
            DistributionId: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID,
            InvalidationBatch: {
                CallerReference: Date.now().toString(),
                Paths: {
                    Quantity: 1,
                    Items: [`/${params.Key}`]
                }
            }
        };

        await cloudfront.createInvalidation(invalidationParams).promise();

        const awsImage = new AwsImage({
            user: userId,
            key: params.Key,
            bucket: params.Bucket,
            distribution: invalidationParams.DistributionId,
            location: uploadResult.Location,
            cloudfrontUrl: `https://${process.env.AWS_CLOUDFRONT_DOMAIN}/${params.Key}`
        });

        await awsImage.save();
        return awsImage;
    } catch (error) {
        throw error;
    }
}

async function uploadProfilePic(userId, file) {
    try {
        // Upload image using existing uploadImage function
        const uploadedImage = await uploadImage(userId, file);

        // Update user's profilePic field with the uploaded image's ID
        await User.findByIdAndUpdate(new mongoose.Types.ObjectId(userId), {
            profilePic: uploadedImage.cloudfrontUrl
        });

        //invalidate user cache
        invalidateCacheStartingWith(`user_${userId}`);

        return uploadedImage;
    } catch (error) {
        throw error;
    }
}


async function downloadImage(imageId) {
    try {
        const image = await AwsImage.findById(imageId);
        if (!image) {
            throw new Error('Image not found');
        }

        const params = {
            Bucket: image.bucket,
            Key: image.key
        };

        const data = await s3.getObject(params).promise();
        return data;
    } catch (error) {
        throw error;
    }
}

async function deleteImage(imageId) {
    try {
        const image = await AwsImage.findById(imageId);
        if (!image) {
            throw new Error('Image not found');
        }

        const params = {
            Bucket: image.bucket,
            Key: image.key
        };

        await s3.deleteObject(params).promise();
        await AwsImage.findByIdAndDelete(imageId);

        return true;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    uploadImage,
    uploadProfilePic,
    downloadImage,
    deleteImage
}; 