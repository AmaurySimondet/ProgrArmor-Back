const mongoose = require('mongoose');
require('dotenv').config();
const ExerciceType = require('../schema/exercicetype');

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const popularityMapping = {
    "Echauffement": 0,
    "Terme générique": 70,
    "Musculation - Haut du corps": 90,
    "Musculation - Bas du corps": 85,
    "Street Workout- Haut du corps": 80,
    "Street Workout - Figures": 75,
    "Street Workout - Freestyle": 30,
    "Musculation - Abdominaux / Lombaires": 50,
    "Explosif / Plyometric": 20,
    "Cardio": 10,
    "Haltérophilie": 25,
    "Bras de fer": 5,
    "Strongman": 2
};

(async () => {
    try {
        // Fetch all exercice types
        const exerciceTypes = await ExerciceType.find({}, 'name').exec();

        for (const exerciceType of exerciceTypes) {
            const nameFr = exerciceType.name.fr;
            console.log(nameFr);

            if (popularityMapping[nameFr] !== undefined) {
                exerciceType.popularityScore = popularityMapping[nameFr];
                exerciceType.updatedAt = new Date();
                await exerciceType.save();
                console.log(`Updated "${nameFr}" with popularity score: ${popularityMapping[nameFr]}`);
            }
        }

        console.log('All exercice type popularity scores updated successfully');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        mongoose.connection.close();
    }
})();
