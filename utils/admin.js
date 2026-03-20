const Seance = require('../schema/seance');
const User = require('../schema/schemaUser.js');

/**
 * Gets basic inscription information including total seances and users
 * @returns {Promise<Object>} Object containing total seances and users
 */
async function getInscriptionInfo(req, res) {
    try {
        const totalSeances = await Seance.countDocuments({});
        const totalUsers = await User.countDocuments({});

        return res.json({
            totalSeances,
            totalUsers
        });
    } catch (err) {
        console.error("Error getting inscription info:", err);
        throw err;
    }
}

module.exports = { getInscriptionInfo };