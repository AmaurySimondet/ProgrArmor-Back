const mongoose = require('mongoose');
const CategorieType = require('../schema/categorietype'); // Adjust the path as needed
const { getOrSetCache, invalidateCacheStartingWith } = require('../utils/cache');
const { normalizeString } = require('../utils/string');
/**
 * Fetches all category types from the database.
 * @param {number} page - The page number to fetch.
 * @param {number} limit - The number of items per page.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of category type objects.
 */
async function getAllCategorieTypes(page = 1, limit = 7) {
    try {
        const cacheKey = `categorieTypes_all:${page}:${limit}`;
        return await getOrSetCache(cacheKey, async () => {
            const total = await CategorieType.countDocuments();
            const categorieTypes = await CategorieType.find()
                .sort({ "popularityScore": -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .exec();

            return { categorieTypes, total };
        });
    } catch (err) {
        console.error("Error fetching category types:", err);
        throw err;
    }
}

/**
 * Fetches a category type by its ID.
 * @param {string} id - The ID of the category type.
 * @param {string} [name] - The name of the category type.
 * @returns {Promise<Object>} - A promise that resolves to the category type object.
 */
async function getCategorieTypeById(id, name) {
    try {
        const cacheKey = `categorieType_${id || ''}_${name || ''}`;
        return await getOrSetCache(cacheKey, async () => {
            let query = {};
            if (id) {
                query._id = mongoose.Types.ObjectId(id);
            }
            if (name) {
                query["$or"] = [{ "name.fr": name }, { "name.en": name }];
            }
            const categorieType = await CategorieType.findOne(query).exec();
            if (!categorieType) {
                throw new Error("Category type not found");
            }
            return categorieType;
        });
    } catch (err) {
        console.error("Error fetching category type by ID:", err);
        throw err;
    }
}

/**
 * Creates a new category type
 * @param {Object} data - The category type data
 * @returns {Promise<Object>} - The created category type
 */
async function createCategorieType(data) {
    try {
        const categorieType = new CategorieType({
            _id: new mongoose.Types.ObjectId(),
            name: {
                fr: data.nameFr,
                en: data.nameEn
            },
            normalizedName: {
                fr: normalizeString(data.nameFr),
                en: normalizeString(data.nameEn)
            },
            popularityScore: data.popularityScore || 0,
            examples: {
                fr: data.examplesFr.filter(ex => ex),
                en: data.examplesEn.filter(ex => ex)
            }
        });

        await categorieType.save();

        //reset cache
        await invalidateCacheStartingWith('categorieTypes_all');
        await invalidateCacheStartingWith('categorieType_');

        return categorieType;
    } catch (err) {
        console.error("Error creating category type:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllCategorieTypes, getCategorieTypeById, createCategorieType };
