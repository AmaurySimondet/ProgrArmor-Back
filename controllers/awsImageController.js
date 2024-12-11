const awsImage = require('../lib/awsImage');
const multer = require('multer');
const upload = multer();

module.exports = function (app) {
    // Upload image
    app.post('/aws/upload-pp', upload.single('image'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }

            const userId = req.body.userId;
            const result = await awsImage.uploadProfilePic(userId, req.file);
            res.json({ success: true, image: result });
        } catch (err) {
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