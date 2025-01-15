const reaction = require('../lib/reaction');
const seanceComment = require('../lib/seanceComment');

module.exports = function (app) {
    // Get seance reactions
    app.get('/seance/:seanceId/reactions', async (req, res) => {
        try {
            const { seanceId } = req.params;
            const userId = req.query.userId;

            const reactionData = await reaction.getReactions(seanceId, userId);
            res.json({ success: true, ...reactionData });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Update seance reaction
    app.post('/seance/:seanceId/reactions', async (req, res) => {
        try {
            const { seanceId } = req.params;
            const { userId, reaction: reactionType, commentId, seanceUser } = req.body;

            const reactionData = await reaction.updateReaction(
                seanceId,
                userId,
                reactionType,
                commentId,
                seanceUser
            );
            res.json({ success: true, ...reactionData });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Get seance comments
    app.get('/seance/:seanceId/comments', async (req, res) => {
        try {
            const { seanceId } = req.params;
            const userId = req.query.userId;
            const commentData = await seanceComment.getSeanceComments(seanceId, userId);
            res.json({ success: true, ...commentData });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Add seance comment
    app.post('/seance/:seanceId/comments', async (req, res) => {
        try {
            const { seanceId } = req.params;
            const { userId, text, seanceUser, identifiedUsers, parentComment } = req.body;

            const newComment = await seanceComment.createComment(seanceId, userId, text, seanceUser, identifiedUsers, parentComment);
            res.json({ success: true, comment: newComment });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Update seance comment
    app.put('/seance/:seanceId/comments/:commentId', async (req, res) => {
        try {
            const { seanceId, commentId } = req.params;
            const { userId, text, identifiedUsers, parentComment } = req.body;

            const updatedComment = await seanceComment.updateComment(
                seanceId,
                commentId,
                userId,
                text,
                identifiedUsers,
                parentComment
            );
            res.json({ success: true, comment: updatedComment });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Delete seance comment
    app.delete('/seance/:seanceId/comments/:commentId', async (req, res) => {
        try {
            const { seanceId, commentId } = req.params;
            const { userId } = req.body;

            console.log("USER ID", userId);
            console.log("SEANCE ID", seanceId);
            console.log("COMMENT ID", commentId);
            await seanceComment.deleteComment(seanceId, commentId, userId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}; 