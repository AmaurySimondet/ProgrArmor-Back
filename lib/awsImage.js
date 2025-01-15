const mongoose = require('mongoose');
const AwsImage = require('../schema/awsImage');
const User = require("../schema/schemaUser.js");
const Seance = require('../schema/seance.js');
const { getOrSetCache, invalidateCacheStartingWith } = require('../utils/cache.js');

/**
 * Records an uploaded image in MongoDB
 * @param {string} userId - The ID of the user uploading the image
 * @param {Object} uploadResult - The result from S3 upload containing Location, Key etc.
 * @param {Date} [seanceDate] - Optional date of the seance
 * @param {string} [seanceName] - Optional name of the seance
 * @returns {Promise<Object>} - A promise that resolves to the saved AWS image object
 */
async function recordUploadedImage(userId, uploadResult, seanceDate = null, seanceName = null) {
    const awsImage = new AwsImage({
        user: userId,
        seanceDate: seanceDate,
        seanceName: seanceName,
        key: uploadResult.key,
        distribution: uploadResult.distribution,
        bucket: uploadResult.bucket,
        location: uploadResult.location,
        cloudfrontUrl: uploadResult.cloudfrontUrl
    });

    await awsImage.save();
    return awsImage;
}

/**
 * Records a profile picture upload and updates user
 * @param {string} userId - The ID of the user
 * @param {Object} uploadResult - The result from S3 upload
 * @returns {Promise<Object>} - A promise that resolves to the recorded image object
 */
async function recordProfilePicUpload(userId, uploadResult) {
    const savedImage = await recordUploadedImage(userId, uploadResult);

    await User.findByIdAndUpdate(
        new mongoose.Types.ObjectId(userId),
        { profilePic: uploadResult.cloudfrontUrl }
    );

    invalidateCacheStartingWith(`user_${userId}`);
    invalidateCacheStartingWith(`all_users`);

    return savedImage;
}

/**
 * Records a seance photo upload
 * @param {string} userId - The ID of the user
 * @param {Object} uploadResult - The result from S3 upload
 * @param {Date} seanceDate - The date of the seance
 * @param {string} seanceName - The name of the seance
 * @returns {Promise<Object>} - A promise that resolves to the recorded image object
 */
async function recordSeancePhotoUpload(userId, uploadResult, seanceDate, seanceName) {
    console.log("Uploading seance photo for user:", userId, "with seance date:", seanceDate, "and seance name:", seanceName, "with upload result:", uploadResult);
    const savedImage = await recordUploadedImage(userId, uploadResult, seanceDate, seanceName);

    // Invalidate relevant caches
    await invalidateCacheStartingWith(`seance_images_${userId}`);
    await invalidateCacheStartingWith(`user_images_${userId}`);
    if (savedImage.seanceId) {
        await invalidateCacheStartingWith(`seance_photos_${savedImage.seanceId}`);
    }

    return savedImage;
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
                key: { $regex: /\.(jpg|jpeg|png|gif|webp)$/i },
                seanceName: { $ne: "Aide" }
            }).sort({ createdAt: -1 });

            return foundImages || [];
        });

        return images;
    } catch (error) {
        throw error;
    }
}

/**
 * Removes image record and updates related collections
 * @param {string} photoUrl - The cloudfront URL of the photo to delete
 * @returns {Promise<boolean>} - A promise that resolves to true if deletion is successful
 */
async function removeSeancePhoto(photoUrl) {
    try {
        const image = await AwsImage.findOne({ cloudfrontUrl: photoUrl });
        if (!image) {
            throw new Error('Image not found');
        }

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

module.exports = {
    recordUploadedImage,
    recordProfilePicUpload,
    recordSeancePhotoUpload,
    getSeanceImages,
    getUserImages,
    getPhotosBySeanceId,
    removeSeancePhoto
}; 