const SeanceComment = require('../schema/seanceComment');
const { getOrSetCache, invalidateCommentsAndReactions } = require('../utils/cache');
const Reaction = require('../schema/reaction');
const { getTopReactions } = require('../utils/reaction');
const { upsertNotification } = require('./notification');

/**
 * Get the comments for a seance
 * @param {string} seanceId - The ID of the seance
 * @param {string} userId - The ID of the user
 * @returns {Promise<Object>} - The comments with reactions and top reactions
 */
async function getSeanceComments(seanceId, userId) {
    try {
        const cacheKey = `seance_comments_${seanceId}`;

        const data = await getOrSetCache(cacheKey, async () => {
            // Get total comments count
            const allComments = await SeanceComment.find({ seance: seanceId })
                .populate('user', 'fName lName profilePic')
                .sort({ createdAt: -1 });
            const totalComments = allComments.length;
            const allCommentsReactions = await Reaction.find({ comment: { $in: allComments.map(comment => comment._id) } });
            const allCommentsWithReactions = allComments.map(comment => ({
                comment: comment,
                reactions: allCommentsReactions.filter(reaction => reaction.comment.toString() === comment._id.toString()) || [],
                userReaction: allCommentsReactions.find(reaction =>
                    reaction.comment.toString() === comment._id.toString() &&
                    reaction.user.toString() === userId
                ) || null,
                topReactions: getTopReactions(allCommentsReactions.filter(reaction => reaction.comment.toString() === comment._id.toString()))
            }));
            const topComment = allCommentsWithReactions.reduce((top, current) => {
                return top.reactions.length > current.reactions.length ? top : current;
            }, allCommentsWithReactions[0]) || allCommentsWithReactions[0];

            // Check if user has commented
            const hasUserCommented = allComments.some(comment => comment.user._id.toString() === userId);

            return {
                topComment,
                totalComments,
                comments: allCommentsWithReactions,
                hasUserCommented
            };
        });

        return data;
    } catch (error) {
        throw error;
    }
}

async function createComment(seanceId, userId, commentId, text, seanceUser) {
    try {
        // Create new comment
        const newComment = await SeanceComment.create({
            seance: seanceId,
            user: userId,
            parentComment: commentId,
            text: text
        });

        // Populate user info
        await newComment.populate('user', 'fName lName').execPopulate();

        // Invalidate cache
        await invalidateCommentsAndReactions(seanceId);

        // Create notification
        if (seanceUser !== userId) {
            await upsertNotification({
                type: 'comment',
                fromUser: userId,
                forUser: seanceUser,
                comment: newComment._id,
                seance: seanceId
            });
        }

        // Return formatted comment
        return {
            id: newComment._id,
            text: newComment.text,
            author: {
                id: newComment.user._id,
                name: `${newComment.user.fName} ${newComment.user.lName}`
            },
            createdAt: newComment.createdAt
        };
    } catch (error) {
        throw error;
    }
}


module.exports = {
    getSeanceComments,
    createComment
}; 