const mongoose = require('mongoose');
const Categorie = require('../../schema/categorie');
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
 * @returns {Promise<Object>} - A promise that resolves to an object containing the categories and pagination info.
 */
async function getCategoriesByLanguage(language, page = 1) {
    if (!['fr', 'en'].includes(language)) {
        throw new Error("Invalid language code. Use 'fr' or 'en'.");
    }

    const cacheKey = `categories_${language}_page_${page}`;

    // Check if the result is in cache
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    try {
        // Calculate the number of items to skip
        const skip = (page - 1) * PAGINATION_LIMIT;

        // Fetch categories from the database with pagination
        const categories = await Categorie.find({}, { [`name.${language}`]: 1 }) // Projection to include only the name in the specified language
            .skip(skip)
            .limit(PAGINATION_LIMIT)
            .exec();

        // Get the total count of categories for pagination info
        const totalCategories = await Categorie.countDocuments().exec();

        const result = {
            categories: categories.map(cat => cat.name[language]),
            totalPages: Math.ceil(totalCategories / PAGINATION_LIMIT),
            currentPage: page,
            totalCategories
        };

        // Cache the result
        cache.set(cacheKey, result);

        return result;
    } catch (err) {
        console.error("Error fetching categories:", err);
        throw err;
    }
}

// Export the function
module.exports = { getCategoriesByLanguage };

(async () => {
    try {
        // Define the parameters
        const language = 'en'; // Replace with 'fr' for French
        const page = 3; // Page number to fetch

        // Call the function
        const result = await getCategoriesByLanguage(language, page);

        // Output the result
        console.log(`Categories (Page ${result.currentPage}):`, result.categories);
        console.log(`Total Pages: ${result.totalPages}`);
        console.log(`Total Categories: ${result.totalCategories}`);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();