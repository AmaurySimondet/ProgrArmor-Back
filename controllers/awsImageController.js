const awsImage = require('../lib/awsImage');

module.exports = function (app) {
    function parseBooleanQueryParam(value, defaultValue = undefined) {
        if (value === undefined) {
            return defaultValue;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') {
                return true;
            }
            if (normalized === 'false') {
                return false;
            }
        }

        return defaultValue;
    }

    function hasRequiredUploadFields(uploadResult) {
        return uploadResult && uploadResult.key && uploadResult.cloudfrontUrl;
    }

    // Record profile picture upload
    app.post('/aws/record-pp', async (req, res) => {
        try {
            const { userId, uploadResult } = req.body;

            if (!userId || !hasRequiredUploadFields(uploadResult)) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required parameters: userId and uploadResult with key/cloudfrontUrl are required'
                });
            }

            const result = await awsImage.recordProfilePicUpload(userId, uploadResult);
            res.json({ success: true, image: result });
        } catch (err) {
            console.error('Profile picture recording error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Record seance photo upload
    app.post('/aws/record-seance-photo', async (req, res) => {
        try {
            const { userId, uploadResult, seanceDate, seanceName } = req.body;

            if (!userId || !hasRequiredUploadFields(uploadResult) || !seanceDate || !seanceName) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required parameters: userId, uploadResult with key/cloudfrontUrl, seanceDate, and seanceName are required'
                });
            }

            const result = await awsImage.recordSeancePhotoUpload(userId, uploadResult, seanceDate, seanceName);
            res.json({ success: true, image: result });
        } catch (err) {
            console.error('Seance photo recording error:', err);
            res.status(500).json({
                success: false,
                message: err.message,
                details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
        }
    });

    // Record upload (unified route for profile picture and seance photos)
    app.post('/aws/record-upload', async (req, res) => {
        try {
            const { userId, uploadResult, isProfilePic = false, seanceDate, seanceName } = req.body;

            if (!userId || !hasRequiredUploadFields(uploadResult)) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required parameters: userId and uploadResult with key/cloudfrontUrl are required'
                });
            }

            if (!isProfilePic && (!seanceDate || !seanceName)) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required parameters for seance upload: seanceDate and seanceName are required'
                });
            }

            const image = await awsImage.recordUpload(userId, uploadResult, {
                isProfilePic,
                seanceDate,
                seanceName
            });

            res.json({ success: true, image });
        } catch (err) {
            console.error('Record upload error:', err);
            res.status(500).json({
                success: false,
                message: err.message,
                details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
        }
    });

    // Delete seance photo record
    app.delete('/aws/delete-seance-photo', async (req, res) => {
        try {
            const { photoUrl } = req.query;

            if (!photoUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required query parameters: photoUrl is required'
                });
            }

            await awsImage.removeSeancePhoto(photoUrl);
            res.json({ success: true, message: 'Seance photo record deleted successfully' });
        } catch (err) {
            console.error('Error deleting seance photo record:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get seance photos
    app.get('/aws/get-seance-photos', async (req, res) => {
        try {
            const { userId, seanceDate, seanceName } = req.query;

            if (!userId || !seanceDate || !seanceName) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required query parameters: userId, seanceDate, and seanceName are required'
                });
            }

            const result = await awsImage.getSeanceImages(userId, seanceDate, seanceName);
            res.json({ success: true, images: result });
        } catch (err) {
            console.error('Error fetching seance photos:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get photos by seance ID
    app.get('/aws/get-seance-photos-by-id', async (req, res) => {
        try {
            const seanceId = req.query.seanceId;

            if (!seanceId) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required parameter: seanceId'
                });
            }

            const result = await awsImage.getPhotosBySeanceId(seanceId);
            res.json({ success: true, images: result });
        } catch (err) {
            console.error('Error fetching photos by seance ID:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get user images
    app.get('/aws/images/:userId', async (req, res) => {
        try {
            const userId = req.params.userId;
            const usedOnProfile = parseBooleanQueryParam(req.query.usedOnProfile);
            const images = await awsImage.getUserImages(userId, usedOnProfile);
            res.json({ success: true, images });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Set user profile images (1 to 3 IDs, ordered)
    app.patch('/aws/images/used-on-profile', async (req, res) => {
        try {
            const userId = req.user && req.user._id ? req.user._id.toString() : null;
            const { imageIds } = req.body;

            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            const images = await awsImage.setUsedOnProfileImages(userId, imageIds);
            res.json({ success: true, images });
        } catch (err) {
            const validationMessages = [
                'imageIds must be an array',
                'imageIds must contain between 1 and 3 IDs',
                'imageIds must be unique',
                'One or more imageIds are invalid',
                'One or more images do not belong to this user'
            ];
            const status = validationMessages.includes(err.message) ? 400 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });

    const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

    // Initialize S3 Client (Securely on the server)
    const s3Client = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    // Endpoint to generate Presigned URL
    // POST /user/aws/presigned-url
    app.post('/aws/presigned-url', async (req, res) => {
        try {
            const { userId, fileName, fileType, isProfilePic = false, uploadType } = req.body;

            if (!userId || !fileName || !fileType) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required parameters: userId, fileName, and fileType are required'
                });
            }

            // Create a unique file key
            const fileExtension = fileName.split('.').pop();
            const normalizedUploadType = uploadType === 'profile' || isProfilePic ? 'profile' : 'seance';
            const folder = normalizedUploadType === 'profile' ? 'profile' : 'seances';
            const key = `users/${userId}/${folder}/${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExtension}`;

            const command = new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: key,
                ContentType: fileType,
                // optional: ACL: 'public-read' if your bucket policy allows it and you want public access
            });

            // Generate the URL (valid for 5 minutes)
            const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

            // Return the upload URL and the final public URL
            res.json({
                uploadUrl,
                key,
                cloudfrontUrl: `https://${process.env.AWS_CLOUDFRONT_DOMAIN}/${key}`
            });
        } catch (error) {
            console.error("Error generating presigned URL:", error);
            res.status(500).json({ error: "Failed to generate upload URL" });
        }
    });
}; 