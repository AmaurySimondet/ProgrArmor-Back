const mongoose = require('mongoose');
require('dotenv').config();
const Categorie = require('../schema/categorie');
const Exercice = require('../schema/exercice');
const ExerciceType = require('../schema/exerciceType');
const CategorieType = require('../schema/categorieType');
const { normalizeString } = require('../utils/string');

async function addSomeDocuments() {
    try {
        // Add connection to MongoDB
        await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
        console.log('Connected to MongoDB');

        // Update Categories
        const categories = await Categorie.find({});
        for (const cat of categories) {
            await Categorie.updateOne(
                { _id: cat._id },
                {
                    $set: {
                        'normalizedName.fr': normalizeString(cat.name.fr),
                        'normalizedName.en': normalizeString(cat.name.en)
                    }
                }
            );
        }

        // Update Exercises
        const exercises = await Exercice.find({});
        for (const ex of exercises) {
            await Exercice.updateOne(
                { _id: ex._id },
                {
                    $set: {
                        'normalizedName.fr': normalizeString(ex.name.fr),
                        'normalizedName.en': normalizeString(ex.name.en)
                    }
                }
            );
        }

        // Update Exercise Types
        const exerciseTypes = await ExerciceType.find({});
        for (const type of exerciseTypes) {
            await ExerciceType.updateOne(
                { _id: type._id },
                {
                    $set: {
                        'normalizedName.fr': normalizeString(type.name.fr),
                        'normalizedName.en': normalizeString(type.name.en)
                    }
                }
            );
        }

        // Update Category Types
        const categoryTypes = await CategorieType.find({});
        for (const type of categoryTypes) {
            await CategorieType.updateOne(
                { _id: type._id },
                {
                    $set: {
                        'normalizedName.fr': normalizeString(type.name.fr),
                        'normalizedName.en': normalizeString(type.name.en)
                    }
                }
            );
        }

        console.log('All documents updated successfully');

    } catch (error) {
        console.error('Error adding documents:', error);
    } finally {
        // Close MongoDB connections
        await mongoose.connection.close();
        console.log('Database connections closed');
    }
}

// Execute the copy
addSomeDocuments().catch(console.error); 