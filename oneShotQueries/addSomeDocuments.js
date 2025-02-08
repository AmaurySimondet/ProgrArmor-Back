const mongoose = require('mongoose');
require('dotenv').config();
const Categorie = require('../schema/categorie');
const CategorieType = require('../schema/categorietype');
const { normalizeString } = require('../utils/string');

async function addSomeDocuments() {
    try {
        // Add connection to MongoDB
        await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
        console.log('Connected to MongoDB');

        const schema = Categorie;
        const type = mongoose.Types.ObjectId('67a7b94e63b4932e2690ae6f');
        const namesToAdd = [
            "Technogym",
            "Life Fitness",
            "Precor",
            "Hammer Strength",
            "Cybex",
            "Matrix Fitness",
            "BH Fitness",
            "Tunturi",
            "Gym80",
            "Rogue Fitness",
            "ATX",
            "Kingsbox"
        ];
        // const namesToAdd = ["Marque de machine"]

        for (const name of namesToAdd) {
            await schema.create({
                _id: mongoose.Types.ObjectId(),
                name: { fr: name, en: name },
                type: type,
                // popularityScore: 20,
                normalizedName: { fr: normalizeString(name), en: normalizeString(name) },
                // examples: { fr: ["Technogym", "Matrix Fitness", "Hammer Strength"], en: ["Technogym", "Matrix Fitness", "Hammer Strength"] }
            });
        }

        console.log(`Added ${namesToAdd.length} documents successfully added to ${schema.modelName}`);
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