const mongoose = require('mongoose');
const Detail = require('../schema/detail');
const NodeCache = require("node-cache");
require('dotenv').config();

// Connect to MongoDB (update connection string as necessary)
mongoose.connect(process.env.mongoURL + '/prograrmor', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const PAGINATION_LIMIT = 10; // Adjust this value as needed

// Create an instance of NodeCache
const cache = new NodeCache({ stdTTL: 600 }); // Cache TTL of 600 seconds (10 minutes)

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

    const cacheKey = `details_${language}_page_${page}`;

    // Check if the result is in cache
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    try {
        // Calculate the number of items to skip
        const skip = (page - 1) * PAGINATION_LIMIT;

        // Fetch details from the database with pagination
        const details = await Detail.find({}, { [`name.${language}`]: 1 }) // Projection to include only the name in the specified language
            .skip(skip)
            .limit(PAGINATION_LIMIT)
            .exec();

        // Get the total count of details for pagination info
        const totalDetails = await Detail.countDocuments().exec();

        const result = {
            details: details.map(cat => cat.name[language]),
            totalPages: Math.ceil(totalDetails / PAGINATION_LIMIT),
            currentPage: page,
            totalDetails
        };

        // Cache the result
        cache.set(cacheKey, result);

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
        // Define the parameters
        const language = 'fr'; // Replace with 'fr' for French
        const page = 3; // Page number to fetch

        // Call the function
        const result = await getDetailsByLanguage(language, page);

        // Output the result
        console.log(`Details (Page ${result.currentPage}):`, result.details);
        console.log(`Total Pages: ${result.totalPages}`);
        console.log(`Total Details: ${result.totalDetails}`);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();