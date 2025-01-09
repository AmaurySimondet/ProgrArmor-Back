const mongoose = require('mongoose');
require('dotenv').config();
const Categorie = require('../schema/categorie');

async function addSomeDocuments() {
    try {
        // Add connection to MongoDB
        await mongoose.connect(process.env.mongoURL + '/progarmor');
        console.log('Connected to MongoDB');

        const schema = Categorie;
        const type = mongoose.Types.ObjectId('669cda3b33e75a33610be158');
        const namesToAdd = [
            "Lean"
        ];

        for (const name of namesToAdd) {
            await schema.create({
                _id: mongoose.Types.ObjectId(),
                name: { fr: name, en: name },
                type: type,
            });
        }

        console.log(`Added ${namesToAdd.length} documents successfully`);
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