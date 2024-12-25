const AWS = require('aws-sdk');
const fs = require('fs');
const AwsImage = require('../schema/awsImage');
const { getOrSetCache, invalidateCacheStartingWith } = require('../utils/cache.js');
require('dotenv').config();
const mongoose = require('mongoose');
const User = require("../schema/schemaUser.js");
const Seance = require('../schema/seance.js');
const { compressMedia } = require('../utils/compression.js');

// Consolidate AWS configuration
const awsConfig = {
    region: 'eu-west-3',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    signatureVersion: 'v4'
};

AWS.config.update(awsConfig);

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

/**
 * Checks the status of the CloudFront distribution
 * @returns {Promise<Object>} - A promise that resolves to the distribution status
 */
async function checkDistributionStatus() {
    const params = {
        Id: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID
    };
    return await cloudfront.getDistribution(params).promise();
}

/**
 * Uploads an image to AWS S3 and creates a CloudFront invalidation
 * @param {string} userId - The ID of the user uploading the image
 * @param {Object} file - The file object containing the image data
 * @param {Date} [seanceDate] - Optional date of the seance
 * @param {string} [seanceName] - Optional name of the seance
 * @returns {Promise<Object>} - A promise that resolves to the saved AWS image object
 * @throws {Error} If AWS credentials are missing or file is invalid
 */
async function uploadImage(userId, file, seanceDate = null, seanceName = null) {
    try {
        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            throw new Error('AWS credentials not properly configured');
        }

        if (!file || !file.buffer || !Buffer.isBuffer(file.buffer)) {
            throw new Error('Invalid file format or missing buffer');
        }

        await checkDistributionStatus();

        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${userId}-${Date.now()}.${file.originalname.split('.').pop()}`,
            Body: file.buffer,
            ContentType: file.mimetype || 'application/octet-stream',
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
            seanceDate: seanceDate,
            seanceName: seanceName,
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

/**
 * Uploads a profile picture for a user
 * @param {string} userId - The ID of the user
 * @param {Object} file - The file object containing the image data
 * @returns {Promise<Object>} - A promise that resolves to the uploaded image object
 */
async function uploadProfilePic(userId, file) {
    const compressedBuffer = await compressMedia(file.buffer, file.mimetype);
    const uploadedImage = await uploadImage(userId, { buffer: compressedBuffer, mimetype: file.mimetype, originalname: file.originalname });

    await User.findByIdAndUpdate(
        new mongoose.Types.ObjectId(userId),
        { profilePic: uploadedImage.cloudfrontUrl }
    );

    invalidateCacheStartingWith(`user_${userId}`);
    invalidateCacheStartingWith(`all_users`);

    return uploadedImage;
}

/**
 * Uploads a photo associated with a specific seance
 * @param {string} userId - The ID of the user
 * @param {Object} file - The file object containing the image data
 * @param {Date} seanceDate - The date of the seance
 * @param {string} seanceName - The name of the seance
 * @returns {Promise<Object>} - A promise that resolves to the uploaded image object
 */
async function uploadSeancePhoto(userId, file, seanceDate, seanceName) {
    console.log("Received file:", file, "with mimetype:", file.mimetype, "and originalname:", file.originalname);
    const compressedBuffer = await compressMedia(file.buffer, file.mimetype);
    const uploadedImage = await uploadImage(userId, { buffer: compressedBuffer, mimetype: file.mimetype, originalname: file.originalname }, seanceDate, seanceName);

    // Invalidate relevant caches
    await invalidateCacheStartingWith(`seance_images_${userId}`);
    await invalidateCacheStartingWith(`user_images_${userId}`);
    if (uploadedImage.seanceId) {
        await invalidateCacheStartingWith(`seance_photos_${uploadedImage.seanceId}`);
    }

    return uploadedImage;
}

/**
 * Retrieves images associated with a specific seance
 * @param {string} userId - The ID of the user
 * @param {Date} seanceDate - The date of the seance
 * @param {string} seanceName - The name of the seance
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of image objects
 * @throws {Error} If there's an error retrieving the images
 */
async function getSeanceImages(userId, seanceDate, seanceName) {
    try {
        const cacheKey = `seance_images_${userId}_${seanceDate}_${seanceName}`;

        const images = await getOrSetCache(cacheKey, async () => {
            const foundImages = await AwsImage.find({
                user: userId,
                seanceDate: seanceDate,
                seanceName: seanceName
            }).sort({ createdAt: -1 });

            return foundImages || [];
        });

        return images;
    } catch (error) {
        throw error;
    }
}

/**
 * Retrieves all photos associated with a specific seance ID
 * @param {string} seanceId - The ID of the seance
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of image objects
 * @throws {Error} If there's an error retrieving the images
 */
async function getPhotosBySeanceId(seanceId) {
    try {
        const cacheKey = `seance_photos_${seanceId}`;

        const images = await getOrSetCache(cacheKey, async () => {
            const foundImages = await AwsImage.find({
                seanceId: seanceId
            }).sort({ createdAt: -1 });

            return foundImages || [];
        });

        return images;
    } catch (error) {
        throw error;
    }
}

/**
 * Retrieves all images associated with a specific user
 * @param {string} userId - The ID of the user
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of image objects
 * @throws {Error} If there's an error retrieving the images
 */
async function getUserImages(userId) {
    try {
        const cacheKey = `user_images_${userId}`;

        const images = await getOrSetCache(cacheKey, async () => {
            const foundImages = await AwsImage.find({
                user: userId,
                key: { $regex: /\.(jpg|jpeg|png|gif|webp)$/i }
            }).sort({ createdAt: -1 });

            return foundImages || [];
        });

        return images;
    } catch (error) {
        throw error;
    }
}

/**
 * Downloads an image from AWS S3
 * @param {string} imageId - The ID of the image to download
 * @returns {Promise<Object>} - A promise that resolves to the image data
 * @throws {Error} If the image is not found or there's an error downloading
 */
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

/**
 * Deletes a seance photo and removes its association
 * @param {string} photoUrl - The cloudfront URL of the photo to delete
 * @returns {Promise<boolean>} - A promise that resolves to true if deletion is successful
 * @throws {Error} If the image is not found or there's an error deleting
 */
async function deleteSeancePhoto(photoUrl) {
    try {
        const image = await AwsImage.findOne({
            cloudfrontUrl: photoUrl,
        });

        if (!image) {
            throw new Error('Image not found');
        }

        const params = {
            Bucket: image.bucket,
            Key: image.key
        };

        await s3.deleteObject(params).promise();
        await AwsImage.findByIdAndDelete(image._id);

        // Remove photo URL from any seances that contain it
        await Seance.updateMany(
            { seancePhotos: photoUrl },
            { $pull: { seancePhotos: photoUrl } }
        );

        // Invalidate relevant caches
        await invalidateCacheStartingWith(`seance_images_${image.user}`);
        await invalidateCacheStartingWith(`user_images_${image.user}`);
        if (image.seanceId) {
            await invalidateCacheStartingWith(`seance_photos_${image.seanceId}`);
        }

        return true;
    } catch (error) {
        throw error;
    }
}


/**
 * Deletes an image from AWS S3 and the database
 * @param {string} imageId - The ID of the image to delete
 * @returns {Promise<boolean>} - A promise that resolves to true if deletion is successful
 * @throws {Error} If the image is not found or there's an error deleting
 */
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
    deleteImage,
    uploadSeancePhoto,
    getSeanceImages,
    deleteSeancePhoto,
    getPhotosBySeanceId,
    getUserImages
}; 