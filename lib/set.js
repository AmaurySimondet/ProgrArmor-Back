const mongoose = require('mongoose');
const Set = require('../schema/seanceset'); // Adjust the path as needed
require('dotenv').config();

/**
 * Fetches all sets given parameters.
 * @param {string} userId - The ID of the user.
 * @param {string} seanceId - The ID of the seance.
 * @param {string} exercice - The ID of the exercice.
 * @param {string} categories - The ID of the categories.
 * @param {string} unit - The unit of the value.
 * @param {string} value - The value of the set.
 * @param {string} weightLoad - The weight load of the set.
 * @param {string} elastic - The elastic of the set.
 * @param {string} fields - Optional fields to include in the response
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of set objects.
 */
async function getSets(userId, seanceId, exercice, categories, unit, value, weightLoad, elastic) {
    try {
        const query = { user: mongoose.Types.ObjectId(userId) };
        if (seanceId) {
            query.seance = mongoose.Types.ObjectId(seanceId);
        }
        if (exercice) {
            query.exercice = mongoose.Types.ObjectId(exercice);
        }
        if (categories) {
            let categoriesJson = categories.map(c => JSON.parse(c)); // Parse each string individually
            if (!Array.isArray(categoriesJson)) {
                categoriesJson = [categoriesJson];
            }

            const categoryIds = categoriesJson.map(c => mongoose.Types.ObjectId(c.category));

            // Create a query that matches documents where the `categories` array contains only the specified categories
            query.categories = {
                $size: categoryIds.length,  // Ensures the array has the exact number of elements
                $all: categoryIds.map(id => ({ $elemMatch: { category: id } }))
            };
        }
        if (unit) {
            query.unit = unit;
        }
        if (value) {
            query.value = JSON.parse(value);
        }
        if (weightLoad) {
            query.weightLoad = JSON.parse(weightLoad);
        }
        if (elastic) {
            query.elastic = JSON.parse(elastic);
        }
        console.log("Query for sets:", query);
        const sets = await Set.find(query).exec();
        console.log("Sets found:", sets.length);
        return sets;
    } catch (err) {
        console.error("Error fetching sets:", err);
        throw err;
    }
}

/**
 * Fetches the top exercises for a user.
 * @param {string} userId - The ID of the user.
 * @param {string} by - Optional parameter to specify the field to group by
 * @param {string} asc - Optional parameter to specify the sort order
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top exercises.
 */
async function getTopExercices(userId, by, asc) {
    try {
        let groupBy = 1
        let sort = -1
        if (by) {
            if (by === "repetitions") {
                groupBy = "$value";
            }
            else if (by === "weightLoad") {
                groupBy = "$weightLoad";
            }
            else if (by === "elastic") {
                groupBy = "$elastic";
            }
        }
        if (asc) {
            sort = 1
        }
        const agg = [
            { $match: { user: mongoose.Types.ObjectId(userId) } },
            { $group: { _id: ['$exercice', '$categories'], total: { $sum: groupBy } } },
            { $sort: { total: sort } },
            {
                '$project': {
                    exercice: { '$arrayElemAt': ['$_id', 0] },   // Extract the first element as 'exercice'
                    categories: { '$arrayElemAt': ['$_id', 1] }, // Extract the second element as 'categories'
                    total: 1,  // Include 'total' in the final output
                    _id: 0
                }
            },
        ];
        console.log("Aggregation pipeline:", agg, { _id: ['$exercice', '$categories'], total: { $sum: groupBy } });
        const topExercices = await Set.aggregate(agg).exec();
        return topExercices;
    } catch (err) {
        console.error("Error fetching top exercises:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getSets, getTopExercices };

