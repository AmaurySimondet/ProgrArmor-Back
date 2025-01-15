const Reaction = require('../schema/reaction');
const { getOrSetCache, invalidateCommentsAndReactions } = require('../utils/cache');
const { getTopReactions } = require('../utils/reaction');
const { upsertNotification } = require('./notification');

async function getReactions(seanceId, userId, commentId = null) {
    try {
        const cacheKey = commentId ? `comment_reactions_${commentId}` : `seance_reactions_${seanceId}`;

        const reactions = await getOrSetCache(cacheKey, async () => {
            // If userId is provided, we can get all reactions including user's in one query
            if (userId) {
                const allReactions = await Reaction.aggregate([
                    { $match: { seance: seanceId, comment: commentId } },
                    {
                        $facet: {
                            allReactions: [{ $match: {} }],
                            userReaction: [{ $match: { user: userId } }]
                        }
                    }
                ]);
                return allReactions[0];
            }

            // If no userId, just get all reactions
            const allReactions = await Reaction.find({
                seance: seanceId,
                comment: commentId
            });
            return { allReactions, userReaction: [] };
        });

        return {
            reactions: reactions.allReactions,
            userReaction: reactions.userReaction?.[0] || null,
            topReactions: getTopReactions(reactions.allReactions)
        };
    } catch (error) {
        throw error;
    }
}

async function updateReaction(seanceId, userId, reaction, commentId = null, seanceUser) {
    try {
        const queryCondition = {
            seance: seanceId,
            user: userId,
            comment: commentId
        };

        if (reaction) {
            // Add/Update reaction
            await Reaction.findOneAndUpdate(
                queryCondition,
                { reaction },
                { upsert: true }
            );
        } else {
            // Remove reaction
            await Reaction.findOneAndDelete(queryCondition);
        }

        // Invalidate cache
        await invalidateCommentsAndReactions(seanceId, commentId);

        // Upsert notification
        if (seanceUser !== userId) {
            await upsertNotification({
                type: 'reaction',
                fromUser: userId,
                forUser: seanceUser,
                seance: seanceId,
                comment: commentId
            });
        }

        // Return updated reactions
        return await getReactions(seanceId, userId, commentId);
    } catch (error) {
        throw error;
    }
}

module.exports = {
    getReactions,
    updateReaction
}; 