const mongoose = require('mongoose');
const Categorie = require('../schema/categorie'); // Adjust the path as needed
const { getOrSetCache } = require('../controllers/utils/cache');

/**
 * Fetches all category types from the database.
 * @param {string} categorieType - The category type to filter by.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of category type objects.
 */
async function getAllCategories(categorieType) {
    try {
        const cacheKey = `categories_${categorieType || 'all'}`;
        return await getOrSetCache(cacheKey, async () => {
            query = {};
            if (categorieType) {
                query = { type: mongoose.Types.ObjectId(categorieType) };
            }
            const categorieTypes = await Categorie
                .find(query)
                // .sort({ "popularityScore": -1 })
                .exec();
            return categorieTypes;
        });
    } catch (err) {
        console.error("Error fetching category types:", err);
        throw err;
    }
}

/**
 * Fetches a category by ID from the database.
 * @param {string} id - The ID of the category.
 * @param {string} name - The name of the category.
 * @param {string} fields - The fields to include in the response.
 * @returns {Promise<Object>} - A promise that resolves to the category object.
 */
async function getCategoryById(id, name, fields) {
    try {
        const cacheKey = `category_${id || ''}_${name || ''}_${fields || ''}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {};
            if (id) {
                query = { _id: mongoose.Types.ObjectId(id) };
            }
            if (name) {
                query = { "$or": [{ "name.fr": name }, { "name.en": name }] };
            }
            const category = await Categorie.findOne(query).select(fields).exec();
            return category;
        });
    }
    catch (err) {
        console.error("Error fetching category:", err);
        throw err;
    }
}


module.exports = { getAllCategories, getCategoryById };