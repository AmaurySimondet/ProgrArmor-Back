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

/**
 * Fetches a category by ID from the database.
 * @param {string} id - The ID of the category.
 * @param {string} name - The name of the category.
 * @returns {Promise<Object>} - A promise that resolves to the category object.
 */
async function getCategoryById(id, name) {
    try {
        console.log("Fetching category by ID:", id);
        console.log("Fetching category by name:", name);
        let query = {};
        if (id) {
            query = { _id: mongoose.Types.ObjectId(id) };
        }
        if (name) {
            query = { "$or": [{ "name.fr": name }, { "name.en": name }] };
        }
        const category = await Categorie.findOne(query).exec();
        return category;
    }
    catch (err) {
        console.error("Error fetching category:", err);
        throw err;
    }
}


module.exports = { getAllCategories, getCategoryById };