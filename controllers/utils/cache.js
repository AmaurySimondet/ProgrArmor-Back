const NodeCache = require('node-cache');

// Create cache instance with default TTL of 24 hours
const cache = new NodeCache({
    stdTTL: 86400,
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
    await invalidateCacheStartingWith(`seances_all`);
    await invalidateCacheStartingWith(`seances_${userId}`);
    await invalidateCacheStartingWith(`seance_${seanceId}`);
    await invalidateCacheStartingWith(`lastSeance_${userId}`);
    await invalidateCacheStartingWith(`user_stats_${userId}`);
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
    invalidateSetCaches
}; 
