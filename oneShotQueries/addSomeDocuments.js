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
        // const type = mongoose.Types.ObjectId('67adfe9e4baa3f3bf7d99a28');
        const namesToAdd = [
            "Détail anatomique",
        ];
        // const namesToAdd = ["Pin(s)"]

        for (const name of namesToAdd) {
            await schema.create({
                _id: mongoose.Types.ObjectId(),
                name: { fr: name, en: name },
                // type: type,
                popularityScore: 26,
                normalizedName: { fr: normalizeString(name), en: normalizeString(name) },
                examples: { fr: ["Pin(s) 1", "Pin(s) 2", "Pin(s) 3"], en: ["Pin(s) 1", "Pin(s) 2", "Pin(s) 3"] }
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