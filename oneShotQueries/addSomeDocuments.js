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
        const type = mongoose.Types.ObjectId('67adfe9e4baa3f3bf7d99a28');
        const namesToAdd = [
            "Pin(s) 1",
            "Pin(s) 2",
            "Pin(s) 3",
            "Pin(s) 4",
            "Pin(s) 5",
            "Pin(s) 6",
            "Pin(s) 7",
            "Pin(s) 8",
            "Pin(s) 9",
            "Pin(s) 10",
            "Pin(s) 11",
            "Pin(s) 12",
            "Pin(s) 13",
            "Pin(s) 14",
            "Pin(s) 15",
            "Pin(s) 16",
            "Pin(s) 17",
            "Pin(s) 18",
            "Pin(s) 19",
            "Pin(s) 20",
            "Pin(s) 21",
            "Pin(s) 22",
            "Pin(s) 23",
            "Pin(s) 24",
            "Pin(s) 25",
            "Pin(s) 26",
            "Pin(s) 27",
            "Pin(s) 28",
            "Pin(s) 29",
            "Pin(s) 30",
        ];
        // const namesToAdd = ["Pin(s)"]

        for (const name of namesToAdd) {
            await schema.create({
                _id: mongoose.Types.ObjectId(),
                name: { fr: name, en: name },
                type: type,
                // popularityScore: 10,
                normalizedName: { fr: normalizeString(name), en: normalizeString(name) },
                // examples: { fr: ["Pin(s) 1", "Pin(s) 2", "Pin(s) 3"], en: ["Pin(s) 1", "Pin(s) 2", "Pin(s) 3"] }
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