const SeanceComment = require('../schema/seanceComment');
const Notification = require('../schema/notification');
const { getOrSetCache, invalidateCommentsAndReactions, invalidateCacheStartingWith } = require('../utils/cache');
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
        const cacheKey = `seance_comments_${seanceId}_${userId}`;

        const data = await getOrSetCache(cacheKey, async () => {
            // Get total comments count
            const allComments = await SeanceComment.find({ seance: seanceId })
                .populate('user', 'fName lName profilePic')
                .sort({ createdAt: 1 });
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

async function createComment(seanceId, userId, text, seanceUser, identifiedUsers, parentComment) {
    try {
        // Create new comment
        const newComment = await SeanceComment.create({
            seance: seanceId,
            user: userId,
            parentComment: parentComment,
            text: text,
            identifiedUsers: identifiedUsers
        });

        // Populate user info
        await newComment.populate('user', 'fName lName');

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
            await invalidateCacheStartingWith(`notifications_${seanceUser}`);
        }
        if (identifiedUsers.length > 0) {
            identifiedUsers.forEach(async (user) => {
                await upsertNotification({
                    type: 'identifiedUser',
                    fromUser: userId,
                    forUser: user,
                    comment: newComment._id,
                    seance: seanceId
                });
                await invalidateCacheStartingWith(`notifications_${user}`);
            });
        }
        if (parentComment) {
            await upsertNotification({
                type: 'answer',
                fromUser: userId,
                forUser: parentComment.user,
                comment: newComment._id,
                seance: seanceId
            });
            await invalidateCacheStartingWith(`notifications_${parentComment.user}`);
        }

        return newComment;
    } catch (error) {
        throw error;
    }
}

async function updateComment(seanceId, commentId, userId, text, identifiedUsers, parentComment) {
    try {
        // Find and update the comment
        const comment = await SeanceComment.findOneAndUpdate(
            { _id: commentId, user: userId }, // Ensure user owns the comment
            {
                text: text,
                identifiedUsers: identifiedUsers,
                updatedAt: Date.now(),
                parentComment: parentComment
            },
            { new: true }
        ).populate('user', 'fName lName');

        if (!comment) {
            throw new Error('Comment not found or user not authorized');
        }

        // Invalidate cache
        await invalidateCommentsAndReactions(seanceId);

        // Notify newly identified users
        if (identifiedUsers.length > 0) {
            identifiedUsers.forEach(async (user) => {
                await upsertNotification({
                    type: 'identifiedUser',
                    fromUser: userId,
                    forUser: user,
                    comment: comment._id,
                    seance: seanceId
                });
                await invalidateCacheStartingWith(`notifications_${user}`);
            });
        }

        // Notify parent comment author
        if (parentComment) {
            await upsertNotification({
                type: 'answer',
                fromUser: userId,
                forUser: parentComment.user,
                comment: comment._id,
                seance: seanceId
            });
            await invalidateCacheStartingWith(`notifications_${parentComment.user}`);
        }

        return comment;
    } catch (error) {
        throw error;
    }
}

async function deleteComment(seanceId, commentId, userId) {
    try {
        // Find and delete the comment
        const comment = await SeanceComment.findOneAndDelete({
            _id: commentId,
            user: userId // Ensure user owns the comment
        });

        if (!comment) {
            throw new Error('Comment not found or user not authorized');
        }

        // Delete associated reactions and notifications
        await Reaction.deleteMany({ comment: commentId });
        await Notification.deleteMany({ comment: commentId });

        // Invalidate cache
        await invalidateCommentsAndReactions(seanceId);

        return { success: true };
    } catch (error) {
        throw error;
    }
}

module.exports = {
    getSeanceComments,
    createComment,
    updateComment,
    deleteComment
}; 