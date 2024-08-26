const mongoose = require('mongoose');
const ExerciceType = require('../schema/exercicetype'); // Adjust the path as needed

/**
 * Fetches all exercise types from the database.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercise type objects.
 */
async function getAllExerciceTypes() {
    try {
        const exerciceTypes = await ExerciceType.find().sort({ "popularityScore": -1 }).exec();
        return exerciceTypes;
    } catch (err) {
        console.error("Error fetching exercise types:", err);
        throw err;
    }
}

/**
 * Fetches an exercise type by its ID or name.
 * @param {string} id - The ID of the exercise type.
 * @param {string} [name] - The name of the exercise type.
 * @returns {Promise<Object>} - A promise that resolves to the exercise type object.
 */
async function getExerciceType(id, name) {
    try {
        let query = {};

        if (id) {
            query._id = mongoose.Types.ObjectId(id);
        }

        if (name) {
            query["$or"] = [{ "name.fr": name }, { "name.en": name }];
        }

        const exerciceType = await ExerciceType.findOne(query).exec();

        if (!exerciceType) {
            throw new Error("Exercise type not found");
        }

        return exerciceType;
    } catch (err) {
        console.error("Error fetching exercise type:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllExerciceTypes, getExerciceType };
