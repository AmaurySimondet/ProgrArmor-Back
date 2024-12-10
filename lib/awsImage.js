const AWS = require('aws-sdk');
const fs = require('fs');
const AwsImage = require('../schema/awsImage');
require('dotenv').config();

// Configure AWS
AWS.config.update({
    region: 'us-east-1',
    credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    })
});

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

async function uploadImage(userId, file) {
    try {
        // Set up S3 upload parameters
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${userId}-${Date.now()}.${file.originalname.split('.').pop()}`,
            Body: file.buffer,
            ContentType: file.mimetype
        };

        // Upload to S3
        const uploadResult = await s3.upload(params).promise();

        // Create CloudFront invalidation
        const invalidationParams = {
            DistributionId: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID,
            InvalidationBatch: {
                CallerReference: Date.now().toString(),
                Paths: {
                    Quantity: 1,
                    Items: ['/*']
                }
            }
        };

        const invalidationResult = await cloudfront.createInvalidation(invalidationParams).promise();

        // Create MongoDB record
        const awsImage = new AwsImage({
            user: userId,
            key: params.Key,
            bucket: params.Bucket,
            distribution: invalidationParams.DistributionId,
            location: uploadResult.Location,
            cloudfrontUrl: `https://d28n1fykqesg8f.cloudfront.net/${params.Key}`
        });

        await awsImage.save();

        return awsImage;
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
    downloadImage,
    deleteImage
}; 