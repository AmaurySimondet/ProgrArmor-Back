const mongoose = require('mongoose');
const Exercice = require('../schema/exercice'); // Adjust the path as needed

/**
 * Fetches all exercises from the database.
 * @param {string} [exerciceType] - Optional exercise type to filter
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of exercise objects.
 */
async function getAllExercices(exerciceType) {
    try {
        let query = {};
        if (exerciceType) {
            query = { type: mongoose.Types.ObjectId(exerciceType) };
        }
        const exercices = await Exercice.find(query).exec();
        return exercices;
    } catch (err) {
        console.error("Error fetching exercises:", err);
        throw err;
    }
}

/**
 * Fetches an exercise by its ID.
 * @param {string} id - Optional exercise type to filter
 * @param {string} name - Optional exercise name to filter
 * @returns {Promise<Object>} - A promise that resolves to the exercise object.
 */
async function getExerciceById(id, name) {
    try {
        let query = {};
        if (id) {
            query = { _id: mongoose.Types.ObjectId(id) };
        } else if (name) {
            query = { "$or": [{ "name.fr": name }, { "name.en": name }] };
        }
        const exercice = await Exercice.findOne(query).exec();
        return exercice;
    } catch (err) {
        console.error("Error fetching exercise by ID:", err);
        throw err;
    }
}

// Export the functions
module.exports = { getAllExercices, getExerciceById };
