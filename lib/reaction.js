const mongoose = require('mongoose');
const Reaction = require('../schema/reaction');
const { getTopReactions } = require('../utils/reaction');
const { upsertNotification } = require('./notification');

async function getReactions(seanceId, userId, commentId = null) {
    try {
        let query = { seance: new mongoose.Types.ObjectId(seanceId), comment: commentId ? new mongoose.Types.ObjectId(commentId) : null };
        const allReactions = await Reaction.aggregate([
            {
                $facet: {
                    allReactions: [{ $match: query }],
                    userReaction: [{ $match: { ...query, user: new mongoose.Types.ObjectId(userId) } }]
                }
            }
        ]);
        const reactions = { allReactions: allReactions[0].allReactions, userReaction: allReactions[0].userReaction };

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

        let res = null;
        if (reaction) {
            // Add/Update reaction
            res = await Reaction.findOneAndUpdate(
                queryCondition,
                { reaction },
                { upsert: true }
            );
        } else {
            // Remove reaction
            res = await Reaction.findOneAndDelete(queryCondition);
        }

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
        return res;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    getReactions,
    updateReaction
}; 