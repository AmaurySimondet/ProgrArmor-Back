const mongoose = require('mongoose');
require('dotenv').config();
const CategorieType = require('../schema/categorietype');

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const popularityMapping = {
    "Muscle": 90,
    "Positionnement du corps": 20,
    "Positionnement des bras": 30,
    "Positionnement des jambes": 10,
    "Positionnement des mains": 40,
    "Positionnement des pieds": 35,
    "Positionnement élastique(s)/sangle(s)": 5,
    "Ouverture coudes / genoux": 3,
    "Placement et axe du corps / banc / barre": 50,
    "Type de prise": 45,
    "Point de départ": 15,
    "Type de barre / poids": 68,
    "Accessoire supplémentaire ou objet spécifique": 2,
    "Unilatéral": 60,
    "Type d'éxecution": 55,
    "Type d'éxecution spécifique": 44,
    "Tempo": 37,
    "Forme (Partiel)": 33,
    "Variante Street Workout": 65,
    "Variante d'exercice explosif": 1,
    "Variante d'exercice d'haltérophilie": 53,
    "Gêne / douleur / blessure": 0,
    "Terme générique": 70
};

(async () => {
    try {
        // Fetch all categorie types
        const categorieTypes = await CategorieType.find({}, 'name').exec();

        for (const categorieType of categorieTypes) {
            const nameFr = categorieType.name.fr;

            if (popularityMapping[nameFr] !== undefined) {
                categorieType.popularityScore = popularityMapping[nameFr];
                categorieType.updatedAt = new Date();
                await categorieType.save();
                console.log(`Updated "${nameFr}" with popularity score: ${popularityMapping[nameFr]}`);
            }
        }

        console.log('All categorie type popularity scores updated successfully');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        mongoose.connection.close();
    }
})();
