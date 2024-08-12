const mongoose = require('mongoose');
const ExerciceType = require('../schema/exerciceType'); // Adjust the path as needed

/**
 * Fetches all exercise types from the database.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercise type objects.
 */
async function getAllExerciceTypes() {
    try {
        const exerciceTypes = await ExerciceType.find().exec();
        return exerciceTypes;
    } catch (err) {
        console.error("Error fetching exercise types:", err);
        throw err;
    }
}

/**
 * Fetches an exercise type by its ID.
 * @param {string} id - The ID of the exercise type.
 * @returns {Promise<Object>} - A promise that resolves to the exercise type object.
 */
async function getExerciceTypeById(id) {
    try {
        const exerciceType = await ExerciceType.findById(mongoose.Types.ObjectId(id)).exec();
        if (!exerciceType) {
            throw new Error("Exercise type not found");
        }
        return exerciceType;
    } catch (err) {
        console.error("Error fetching exercise type by ID:", err);
        throw err;
    }
}

/**
 * Fetches an exercise type by its name.
 * @param {string} name - The name of the exercise type.
 * @returns {Promise<Object>} - A promise that resolves to the exercise type object.
 */
async function getExerciceTypeByName(name) {
    try {
        const exerciceType = await ExerciceType.findOne({ "$or": [{ "name.fr": name }, { "name.en": name }] }).exec();
        if (!exerciceType) {
            throw new Error("Exercise type not found");
        }
        return exerciceType._id;
    }
    catch (err) {
        console.error("Error fetching exercise type by name:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllExerciceTypes, getExerciceTypeById, getExerciceTypeByName };
