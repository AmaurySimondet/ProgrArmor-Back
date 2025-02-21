const mongoose = require('mongoose');
const Categorie = require('../schema/categorie'); // Adjust the path as needed
const Set = require('../schema/seanceset');
const { getOrSetCache, invalidateCacheStartingWith } = require('../utils/cache');
const { normalizeString } = require('../utils/string');

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
                query['normalizedName.fr'] = new RegExp(normalizeString(search), 'i');
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

/**
 * Creates a new category
 * @param {Object} data - The category data
 * @returns {Promise<Object>} - The created category
 */
async function createCategorie(data) {
    try {
        const categorie = new Categorie({
            _id: new mongoose.Types.ObjectId(),
            name: {
                fr: data.nameFr,
                en: data.nameEn
            },
            normalizedName: {
                fr: normalizeString(data.nameFr),
                en: normalizeString(data.nameEn)
            },
            type: mongoose.Types.ObjectId(data.associatedType),
        });

        await categorie.save();

        //reset cache
        await invalidateCacheStartingWith('categories_');
        await invalidateCacheStartingWith('category_');

        return categorie;
    } catch (err) {
        console.error("Error creating category:", err);
        throw err;
    }
}

/**
 * Fetches favorite categories based on usage frequency for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} exerciceId - Optional exercice ID to filter by.
 * @param {number} page - The page number to fetch.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Object>} - A promise that resolves to favorite categories with pagination.
 */
async function getFavoriteCategories(userId, exerciceId, page = 1, limit = 7) {
    try {
        const cacheKey = `favorite_categories_${userId}_${exerciceId || ''}_${page}_${limit}`;
        return await getOrSetCache(cacheKey, async () => {
            const match = {
                user: mongoose.Types.ObjectId(userId)
            };
            if (exerciceId) {
                match.exercice = mongoose.Types.ObjectId(exerciceId);
            }

            const pipeline = [
                { $match: match },
                { $unwind: "$categories" },
                {
                    $group: {
                        _id: "$categories.category",
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $skip: (page - 1) * limit },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'categories',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'categoryDetails'
                    }
                },
                { $unwind: "$categoryDetails" },
                {
                    $project: {
                        _id: 1,
                        count: 1,
                        name: "$categoryDetails.name",
                        type: "$categoryDetails.type"
                    }
                }
            ];

            const [results, countResult] = await Promise.all([
                Set.aggregate(pipeline),
                Set.aggregate([
                    { $match: match },
                    { $unwind: "$categories" },
                    { $group: { _id: "$categories.category" } },
                    { $count: "total" }
                ])
            ]);

            const total = countResult[0]?.total || 0;

            return { categories: results, total };
        });
    } catch (err) {
        console.error("Error fetching favorite categories:", err);
        throw err;
    }
}

module.exports = { getAllCategories, getCategoryById, createCategorie, getFavoriteCategories };