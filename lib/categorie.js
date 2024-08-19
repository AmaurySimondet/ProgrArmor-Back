const mongoose = require('mongoose');
const Categorie = require('../schema/categorie'); // Adjust the path as needed

/**
 * Fetches all category types from the database.
 * @param {string} categorieType - The category type to filter by.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of category type objects.
 */
async function getAllCategories(categorieType) {
    try {
        query = {};
        if (categorieType) {
            query = { categorieType: categorieType };
        }
        const categorieTypes = await Categorie
            .find(query)
            // .sort({ "popularityScore": -1 })
            .exec();
        return categorieTypes;
    } catch (err) {
        console.error("Error fetching category types:", err);
        throw err;
    }
}

module.exports = { getAllCategories };