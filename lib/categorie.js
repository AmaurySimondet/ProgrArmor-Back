const mongoose = require('mongoose');
const Categorie = require('../schema/categorie'); // Adjust the path as needed
const { getOrSetCache } = require('../utils/cache');

/**
 * Fetches all categories from the database.
 * @param {string} categorieType - The category type to filter by.
 * @param {number} page - The page number to fetch.
 * @param {number} limit - The number of items per page.
 * @param {string} search - The search query.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of category objects.
 */
async function getAllCategories(categorieType, page = 1, limit = 7, search = '') {
    try {
        const cacheKey = `categories_${categorieType || 'all'}_${page}_${limit}_${search}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {};
            if (categorieType) {
                query.type = mongoose.Types.ObjectId(categorieType);
            }
            if (search) {
                query['name.fr'] = new RegExp(search, 'i');
            }

            const total = await Categorie.countDocuments(query);
            let categoriesQuery = Categorie.find(query);

            // Only apply pagination if no categorieType is specified
            if (!categorieType) {
                categoriesQuery = categoriesQuery
                    .skip((page - 1) * limit)
                    .limit(limit);
            }

            const categories = await categoriesQuery.exec();

            return { categories, total };
        });
    } catch (err) {
        console.error("Error fetching categories:", err);
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