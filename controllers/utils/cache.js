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


const clearCache = () => {
    cache.flushAll();
};

module.exports = {
    cache,
    getOrSetCache,
    invalidateCache,
    clearCache,
    invalidateCacheStartingWith
}; 
