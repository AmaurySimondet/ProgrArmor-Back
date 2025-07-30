const mongoose = require("mongoose");
const Variation = require("../schema/variation");
const Type = require("../schema/type");
const Megatype = require("../schema/megatype");
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        console.log("Début de la mise à jour des variations avec leur megatype...");

        // 1. Récupérer tous les types
        const types = await Type.find({}).exec();
        console.log(`Récupéré ${types.length} types.`);

        // 2. Récupérer toutes les variations
        const variations = await Variation.find({}).populate('type').exec();
        console.log(`Récupéré ${variations.length} variations.`);

        // 3. Créer un mapping des types vers leurs megatypes
        const typeToMegatypeMapping = new Map();

        for (const type of types) {
            if (type.megatype) {
                typeToMegatypeMapping.set(type._id.toString(), type.megatype);
            }
        }

        console.log(`Mapping créé pour ${typeToMegatypeMapping.size} types avec megatype.`);

        // 4. Mettre à jour les variations avec leur megatype
        let updatedCount = 0;
        let skippedCount = 0;

        for (const variation of variations) {
            if (variation.type && variation.type._id) {
                const typeId = variation.type._id.toString();
                const megatypeId = typeToMegatypeMapping.get(typeId);

                if (megatypeId) {
                    // Mettre à jour la variation avec le megatype
                    await Variation.updateOne(
                        { _id: variation._id },
                        {
                            $set: {
                                megatype: megatypeId,
                                updatedAt: new Date()
                            }
                        }
                    );
                    updatedCount++;
                    console.log(`Variation ${variation.name.fr} mise à jour avec megatype: ${megatypeId}`);
                } else {
                    skippedCount++;
                    console.log(`Aucun megatype trouvé pour la variation ${variation.name.fr} (type: ${typeId})`);
                }
            } else {
                skippedCount++;
                console.log(`Variation ${variation._id} sans type valide`);
            }
        }

        console.log(`\nRésumé de la mise à jour:`);
        console.log(`- Variations mises à jour: ${updatedCount}`);
        console.log(`- Variations ignorées: ${skippedCount}`);
        console.log(`- Total de variations traitées: ${variations.length}`);

        console.log("Mise à jour des variations avec megatype terminée avec succès.");
    } catch (err) {
        console.error("Erreur lors de la mise à jour des variations:", err);
    } finally {
        // Fermer la connexion MongoDB
        await mongoose.connection.close();
        console.log("Connexion MongoDB fermée.");
    }
})(); 