const mongoose = require('mongoose');
const Categorie = require('../schema/categorie'); // Adjust the path as needed
const Set = require('../schema/seanceset');
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
        let query = {};
            if (categorieType) {
                query.type = new mongoose.Types.ObjectId(categorieType);
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
        let query = {};
        if (id) {
            query = { _id: new mongoose.Types.ObjectId(id) };
        }
        if (name) {
            query = { "$or": [{ "name.fr": name }, { "name.en": name }] };
        }
        const category = await Categorie.findOne(query).select(fields).exec();
        return category;
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
            type: new mongoose.Types.ObjectId(data.associatedType),
        });

        await categorie.save();
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
        const match = {
                user: new mongoose.Types.ObjectId(userId)
            };
            if (exerciceId) {
                match.exercice = new mongoose.Types.ObjectId(exerciceId);
            }

            const pipeline = [
                { $match: match },
                { $project: { "categories._id": 0 } },
                {
                    $group: {
                        _id: "$categories",
                        count: { $sum: 1 }
                    }
                },
                {
                    $match: {
                        "_id": { $ne: [] }
                    }
                },
                { $sort: { count: -1 } },
                { $skip: (page - 1) * limit },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'categories',
                        localField: '_id.category',
                        foreignField: '_id',
                        as: 'categoryDetails'
                    }
                },
                {
                    $project: {
                        _id: 1,
                        count: 1,
                        name: "$categoryDetails.name"
                    }
                }
            ];

            const [results, countResult] = await Promise.all([
                Set.aggregate(pipeline),
                Set.aggregate([
                    { $match: match },
                    { $project: { "categories._id": 0 } },
                    { $group: { _id: "$categories" } },
                    { $match: { "_id": { $ne: [] } } },
                    { $count: "total" }
                ])
            ]);

            const total = countResult[0]?.total || 0;

        return { categories: results, total };
    } catch (err) {
        console.error("Error fetching favorite categories:", err);
        throw err;
    }
}

module.exports = { getAllCategories, getCategoryById, createCategorie, getFavoriteCategories };