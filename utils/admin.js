const Seance = require('../schema/seance');
const User = require('../schema/schemaUser.js');
const { getOrSetCache } = require('./cache');

/**
 * Gets basic inscription information including total seances and users
 * @returns {Promise<Object>} Object containing total seances and users
 */
async function getInscriptionInfo(req, res) {
    try {
        const cacheKey = 'inscription_info';

        return res.json(await getOrSetCache(cacheKey, async () => {
            // Get total counts
            const totalSeances = await Seance.countDocuments({});
            const totalUsers = await User.countDocuments({});

            return {
                totalSeances,
                totalUsers
            }
        }));

    } catch (err) {
        console.error("Error getting inscription info:", err);
        throw err;
    }
}

module.exports = { getInscriptionInfo };