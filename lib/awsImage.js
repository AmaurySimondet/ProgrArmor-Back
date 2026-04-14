const mongoose = require('mongoose');
const AwsImage = require('../schema/awsImage');
const User = require("../schema/schemaUser.js");
const Seance = require('../schema/seance.js');

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

    return savedImage;
}

/**
 * Records upload based on upload type/context
 * @param {string} userId - The ID of the user
 * @param {Object} uploadResult - The result from S3 upload
 * @param {Object} options - Upload context
 * @param {boolean} [options.isProfilePic=false] - Whether upload is a profile picture
 * @param {Date} [options.seanceDate] - Optional seance date
 * @param {string} [options.seanceName] - Optional seance name
 * @returns {Promise<Object>} - Saved image document
 */
async function recordUpload(userId, uploadResult, options = {}) {
    const { isProfilePic = false, seanceDate = null, seanceName = null } = options;

    if (isProfilePic) {
        return recordProfilePicUpload(userId, uploadResult);
    }

    return recordSeancePhotoUpload(userId, uploadResult, seanceDate, seanceName);
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
        const images = await AwsImage.find({
            user: userId,
            seanceDate: seanceDate,
            seanceName: seanceName
        }).sort({ createdAt: -1 });

        return images || [];
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
        const images = await AwsImage.find({
            seanceId: seanceId
        }).sort({ createdAt: -1 });

        return images || [];
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
async function getUserImages(userId, usedOnProfile = undefined) {
    try {
        const baseQuery = {
            user: userId,
            key: { $regex: /\.(jpg|jpeg|png|gif|webp)$/i },
            seanceName: { $ne: "Aide" }
        };

        if (usedOnProfile) {
            const profileImages = await AwsImage.find({
                ...baseQuery,
                usedOnProfile: true
            }).sort({ usedOnProfileOrder: 1, createdAt: -1 });

            if (profileImages.length > 0) {
                return profileImages;
            }

            const fallbackImages = await AwsImage.find(baseQuery)
                .sort({ createdAt: -1 })
                .limit(3);

            return fallbackImages || [];
        }

        const images = await AwsImage.find(baseQuery).sort({ createdAt: -1 });

        return images || [];
    } catch (error) {
        throw error;
    }
}

/**
 * Sets the list of images used on profile for a user
 * @param {string} userId - The ID of the user
 * @param {Array<string>} imageIds - Ordered array of image IDs (min 1, max 3)
 * @returns {Promise<Array<Object>>} - Updated profile images in display order
 */
async function setUsedOnProfileImages(userId, imageIds) {
    if (!Array.isArray(imageIds)) {
        throw new Error('imageIds must be an array');
    }

    if (imageIds.length < 1 || imageIds.length > 3) {
        throw new Error('imageIds must contain between 1 and 3 IDs');
    }

    const uniqueIds = new Set(imageIds);
    if (uniqueIds.size !== imageIds.length) {
        throw new Error('imageIds must be unique');
    }

    const hasInvalidObjectId = imageIds.some((id) => !mongoose.Types.ObjectId.isValid(id));
    if (hasInvalidObjectId) {
        throw new Error('One or more imageIds are invalid');
    }

    const objectIds = imageIds.map((id) => new mongoose.Types.ObjectId(id));
    const ownedImagesCount = await AwsImage.countDocuments({
        _id: { $in: objectIds },
        user: userId
    });

    if (ownedImagesCount !== imageIds.length) {
        throw new Error('One or more images do not belong to this user');
    }

    await AwsImage.updateMany(
        {
            user: userId,
            _id: { $nin: objectIds }
        },
        {
            $set: {
                usedOnProfile: false,
                usedOnProfileOrder: null
            }
        }
    );

    await AwsImage.bulkWrite(
        objectIds.map((objectId, index) => ({
            updateOne: {
                filter: { _id: objectId, user: userId },
                update: {
                    $set: {
                        usedOnProfile: true,
                        usedOnProfileOrder: index + 1
                    }
                }
            }
        }))
    );

    return getUserImages(userId, true);
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

        return true;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    recordUploadedImage,
    recordUpload,
    recordProfilePicUpload,
    recordSeancePhotoUpload,
    getSeanceImages,
    getUserImages,
    setUsedOnProfileImages,
    getPhotosBySeanceId,
    removeSeancePhoto
};