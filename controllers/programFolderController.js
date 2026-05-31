const programFolder = require('../lib/programFolder');

module.exports = function (app) {
    app.get('/programFolders', async (req, res) => {
        try {
            const userId = req.query.userId;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'userId is required' });
            }
            const folders = await programFolder.getProgramFolders(userId);
            res.json({ success: true, folders });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/programFolder', async (req, res) => {
        try {
            const authenticatedUserId = req.user?._id?.toString();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const folder = await programFolder.createProgramFolder(authenticatedUserId, req.body || {});
            res.json({ success: true, folder });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.put('/programFolder', async (req, res) => {
        try {
            const authenticatedUserId = req.user?._id?.toString();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const folderId = req.query.id;
            if (!folderId) {
                return res.status(400).json({ success: false, message: 'id is required' });
            }
            const folder = await programFolder.updateProgramFolder(folderId, authenticatedUserId, req.body || {});
            res.json({ success: true, folder });
        } catch (err) {
            const status = err.message.includes('forbidden') || err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });

    app.delete('/programFolder', async (req, res) => {
        try {
            const authenticatedUserId = req.user?._id?.toString();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const folderId = req.query.id;
            if (!folderId) {
                return res.status(400).json({ success: false, message: 'id is required' });
            }
            const result = await programFolder.deleteProgramFolder(folderId, authenticatedUserId);
            res.json({ success: true, ...result });
        } catch (err) {
            const status = err.message.includes('forbidden') || err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });
};
