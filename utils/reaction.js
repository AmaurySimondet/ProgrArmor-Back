/**
 * Get the top 3 reactions from a list of reactions
 * @param {Array} reactions - The list of reactions
 * @returns {Array} - The top 3 reactions
 */
const getTopReactions = (reactions) => {
    // Count occurrences of each reaction
    const reactionCounts = reactions.reduce((acc, reaction) => {
        acc[reaction.reaction] = (acc[reaction.reaction] || 0) + 1;
        return acc;
    }, {});

    // Sort and get top 3 reactions
    const top3 = Object.entries(reactionCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .filter(([, count]) => count > 0)
        .map(([reaction]) => reaction);
    return top3;
};

module.exports = { getTopReactions }