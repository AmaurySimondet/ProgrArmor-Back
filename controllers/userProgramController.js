const userProgram = require('../lib/userProgram');

module.exports = function (app) {
    app.get('/programs/examples', async (req, res) => {
        try {
            const examples = await userProgram.getProgramExamples();
            res.json({ success: true, examples });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/programs/from-example', async (req, res) => {
        try {
            const authenticatedUserId = req.user?._id?.toString();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const exampleId = req.body?.exampleId;
            if (!exampleId) {
                return res.status(400).json({ success: false, message: 'exampleId is required' });
            }
            const program = await userProgram.ensureProgramFromExample(authenticatedUserId, exampleId);
            res.json({ success: true, program });
        } catch (err) {
            const status = err.message.includes('Unknown program example') ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });

    app.get('/programs/suggestions', async (req, res) => {
        try {
            const userId = req.query.userId;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'userId is required' });
            }
            const result = await userProgram.getProgramSuggestions(userId);
            res.json({ success: true, ...result });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/programs', async (req, res) => {
        try {
            const userId = req.query.userId;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'userId is required' });
            }
            const programs = await userProgram.getPrograms(userId, {
                folderId: req.query.folderId,
                archived: req.query.archived,
                includeFolderless: req.query.folderId === 'null',
            });
            res.json({ success: true, programs });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/program', async (req, res) => {
        try {
            const userId = req.query.userId;
            const programId = req.query.id;
            if (!userId || !programId) {
                return res.status(400).json({ success: false, message: 'userId and id are required' });
            }
            const program = await userProgram.getProgramById(programId, userId);
            res.json({ success: true, program });
        } catch (err) {
            const status = err.message.includes('forbidden') || err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });

    app.post('/program', async (req, res) => {
        try {
            const authenticatedUserId = req.user?._id?.toString();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const program = await userProgram.createProgram(authenticatedUserId, req.body || {});
            res.json({ success: true, program });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.put('/program', async (req, res) => {
        try {
            const authenticatedUserId = req.user?._id?.toString();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const programId = req.query.id;
            if (!programId) {
                return res.status(400).json({ success: false, message: 'id is required' });
            }
            const program = await userProgram.updateProgram(programId, authenticatedUserId, req.body || {});
            res.json({ success: true, program });
        } catch (err) {
            const status = err.message.includes('forbidden') || err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });

    app.delete('/program', async (req, res) => {
        try {
            const authenticatedUserId = req.user?._id?.toString();
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const programId = req.query.id;
            if (!programId) {
                return res.status(400).json({ success: false, message: 'id is required' });
            }
            const result = await userProgram.deleteProgram(programId, authenticatedUserId);
            res.json({ success: true, ...result });
        } catch (err) {
            const status = err.message.includes('forbidden') || err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ success: false, message: err.message });
        }
    });
};
