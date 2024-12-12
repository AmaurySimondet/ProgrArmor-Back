const awsImage = require('../lib/awsImage');
const multer = require('multer');

// Configure multer storage
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

module.exports = function (app) {
    // Upload image
    app.post('/aws/upload-pp', upload.single('image'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }

            // Add debug logging
            console.log('File received:', {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                buffer: req.file.buffer ? 'Buffer exists' : 'No buffer'
            });

            const userId = req.body.userId;
            const result = await awsImage.uploadProfilePic(userId, req.file);
            res.json({ success: true, image: result });
        } catch (err) {
            console.error('Upload error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Upload seance photo
    app.post('/aws/upload-seance-photo', upload.single('image'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }

            // Add debug logging
            console.log('Seance photo received:', {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                buffer: req.file.buffer ? 'Buffer exists' : 'No buffer'
            });

            const { userId, seanceDate, seanceName } = req.body;

            if (!userId || !seanceDate || !seanceName) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: userId, seanceDate, and seanceName are required'
                });
            }

            const result = await awsImage.uploadSeancePhoto(userId, req.file, seanceDate, seanceName);
            res.json({ success: true, image: result });
        } catch (err) {
            console.error('Seance photo upload error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete seance photo
    app.delete('/aws/delete-seance-photo', async (req, res) => {
        try {
            const { photoUrl } = req.query;

            if (!photoUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required query parameters: photoUrl is required'
                });
            }

            await awsImage.deleteSeancePhoto(photoUrl);
            res.json({ success: true, message: 'Seance photo deleted successfully' });
        } catch (err) {
            console.error('Error deleting seance photo:', err);
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

    // Download image
    app.get('/aws/download/:id', async (req, res) => {
        try {
            const imageId = req.params.id;
            const data = await awsImage.downloadImage(imageId);

            res.writeHead(200, {
                'Content-Type': data.ContentType,
                'Content-Length': data.ContentLength
            });
            res.write(data.Body, 'binary');
            res.end(null, 'binary');
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete image
    app.delete('/aws/delete/:id', async (req, res) => {
        try {
            const imageId = req.params.id;
            await awsImage.deleteImage(imageId);
            res.json({ success: true, message: 'Image deleted successfully' });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get user images
    app.get('/aws/images/:userId', async (req, res) => {
        try {
            const userId = req.params.userId;
            const images = await AwsImage.find({ user: userId }).sort({ createdAt: -1 });
            res.json({ success: true, images });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 