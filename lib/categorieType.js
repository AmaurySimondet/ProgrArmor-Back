const mongoose = require('mongoose');
const CategorieType = require('../schema/categorieType'); // Adjust the path as needed

/**
 * Fetches all category types from the database.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of category type objects.
 */
async function getAllCategorieTypes() {
    try {
        const categorieTypes = await CategorieType.find().sort({ "popularityScore": -1 }).exec();
        return categorieTypes;
    } catch (err) {
        console.error("Error fetching category types:", err);
        throw err;
    }
}

/**
 * Fetches a category type by its ID.
 * @param {string} id - The ID of the category type.
 * @returns {Promise<Object>} - A promise that resolves to the category type object.
 */
async function getCategorieTypeById(id) {
    try {
        const categorieType = await CategorieType.findById(mongoose.Types.ObjectId(id)).exec();
        if (!categorieType) {
            throw new Error("Category type not found");
        }
        return categorieType;
    } catch (err) {
        console.error("Error fetching category type by ID:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllCategorieTypes, getCategorieTypeById };
