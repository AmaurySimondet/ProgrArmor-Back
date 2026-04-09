const mongoose = require('mongoose');
const Detail = require('../schema/detail');
require('dotenv').config();
const { detail: { PAGINATION_LIMIT } } = require('../constants');

// Connect to MongoDB (update connection string as necessary)
mongoose.connect(process.env.mongoURL + '/prograrmor', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

/**
 * Fetches all category names in the specified language with pagination.
 * @param {string} language - The language code ('fr' or 'en').
 * @param {number} page - The page number for pagination.
 * @returns {Promise<Object>} - A promise that resolves to an object containing the details and pagination info.
 */
async function getDetailsByLanguage(language, page = 1) {
    if (!['fr', 'en'].includes(language)) {
        throw new Error("Invalid language code. Use 'fr' or 'en'.");
    }

    try {
        const skip = (page - 1) * PAGINATION_LIMIT;

        const details = await Detail.find({}, { [`name.${language}`]: 1 })
            .skip(skip)
            .limit(PAGINATION_LIMIT)
            .exec();

        const totalDetails = await Detail.countDocuments().exec();

        const result = {
            details: details.map(cat => cat.name[language]),
            totalPages: Math.ceil(totalDetails / PAGINATION_LIMIT),
            currentPage: page,
            totalDetails
        };

        return result;
    } catch (err) {
        console.error("Error fetching details:", err);
        throw err;
    }
}

// Export the function
module.exports = { getDetailsByLanguage };

(async () => {
    try {
        const language = 'fr';
        const page = 3;

        const result = await getDetailsByLanguage(language, page);

        console.log(`Details (Page ${result.currentPage}):`, result.details);
        console.log(`Total Pages: ${result.totalPages}`);
        console.log(`Total Details: ${result.totalDetails}`);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await mongoose.connection.close();
    }
})();
