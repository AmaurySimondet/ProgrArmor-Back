const NodeCache = require('node-cache');

// Create cache instance with default TTL of 12 hours
const cache = new NodeCache({
    stdTTL: 12 * 60 * 60,
    checkperiod: 120,
    useClones: false
});

const getOrSetCache = async (key, cb) => {
    const value = cache.get(key);
    if (value) {
        console.log(`Cache hit for key: ${key}`);
        return value;
    }

    const result = await cb();
    cache.set(key, result);
    return result;
};

const invalidateCache = (key) => {
    console.log(`Invalidating cache for key: ${key}`);
    cache.del(key);
};

const invalidateCacheStartingWith = (keyStart) => {
    const keys = cache.keys();
    keys.forEach(key => {
        if (key.startsWith(keyStart)) {
            invalidateCache(key);
        }
    });
};

/**
 * Invalidate seance caches
 * @param {string} userId - The ID of the user.
 * @param {string} seanceId - The ID of the seance.
 */
const invalidateSeanceCaches = async (userId, seanceId) => {
    await invalidateCacheStartingWith(`seances`);
    await invalidateCacheStartingWith(`seance_${seanceId}`);
    await invalidateCacheStartingWith(`lastSeance_${userId}`);
    await invalidateCacheStartingWith(`user_stats_${userId}`);
    await invalidateCacheStartingWith(`regularity_score_${userId}`);
    await invalidateCacheStartingWith(`seanceNames_${userId}`);
    console.log(`Invalidated seance caches for user: ${userId} and seance: ${seanceId}`);
};


/**
 * Invalidate set caches
 * @param {string} userId - The ID of the user.
 */
const invalidateSetCaches = async (userId) => {
    await invalidateCacheStartingWith(`sets_${userId || ''}`);
    await invalidateCacheStartingWith(`topExercices:${userId || ''}`);
    await invalidateCacheStartingWith(`topFormat_${userId || ''}`);
    await invalidateCacheStartingWith(`prs_${userId || ''}`);
    console.log(`Invalidated set caches for user: ${userId}`);
};

/**
 * Invalidate user caches
 * @param {string} userId - The ID of the user.
 */
const invalidateUserCaches = async (userId) => {
    invalidateCacheStartingWith(`user_stats_${userId}`);
    invalidateCacheStartingWith(`regularity_score_${userId}`);
    invalidateCacheStartingWith(`user_${userId}`);
    invalidateCacheStartingWith(`all_users`);
    console.log(`Invalidated user caches for user: ${userId}`);
};

/**
 * Invalidate comments and reactions caches
 * @param {string} seanceId - The ID of the seance.
 * @param {string} commentId - Optional comment ID.
 */
const invalidateCommentsAndReactions = async (seanceId, commentId = null) => {
    await invalidateCacheStartingWith(`seance_reactions_${seanceId}`);
    await invalidateCacheStartingWith(`seance_comments_${seanceId}`);
    if (commentId) {
        await invalidateCacheStartingWith(`comment_reactions_${commentId}`);
    }
    console.log(`Invalidated comments and reactions caches for seance: ${seanceId}${commentId ? ` and comment: ${commentId}` : ''}`);
};



const clearCache = () => {
    cache.flushAll();
};

module.exports = {
    cache,
    getOrSetCache,
    invalidateCache,
    clearCache,
    invalidateCacheStartingWith,
    invalidateSeanceCaches,
    invalidateSetCaches,
    invalidateUserCaches,
    invalidateCommentsAndReactions
}; 