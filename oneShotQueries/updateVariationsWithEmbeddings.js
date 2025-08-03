const mongoose = require("mongoose");
const axios = require("axios");
const Variation = require("../schema/variation");
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

/**
 * Génère un embedding à partir d'un texte en utilisant le modèle Hugging Face "intfloat/multilingual-e5-large".
 * @param {string} text - Le texte à encoder (avec préfixe automatique "query:").
 * @returns {Promise<number[]|null>} - Le vecteur d'embedding ou null en cas d'erreur.
 */
async function generateEmbedding(text) {
    const apiUrl = 'https://api-inference.huggingface.co/models/intfloat/multilingual-e5-large';
    const payload = {
        inputs: `query: ${text}`,
        options: { wait_for_model: true }
    };
    const headers = {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await axios.post(apiUrl, payload, {
            headers,
            timeout: 30000 // 30 secondes
        });

        return response.data;
    } catch (error) {
        console.error('Erreur lors de la génération d\'embedding :', error.message);
        if (error.response) {
            console.error('Détails de l\'erreur :', error.response.data);
        }
        return null;
    }
}


// Function to create mergedNames text
function createMergedNames(variation) {
    const type = variation.type;
    const megatype = variation.megatype;

    if (!type || !megatype) {
        console.log(`Données manquantes pour la variation ${variation.name.fr}`);
        return null;
    }

    const itemType = variation.isExercice ? "Exercise" : "Detail";

    return `${itemType} named ${variation.name.en} in English and ${variation.name.fr} in French. It is of type ${type.name.en}, or ${type.name.fr} in French. It is from the large category of ${megatype.name.en}, or ${megatype.name.fr} in French.`;
}

(async () => {
    try {
        console.log("�� Début de la mise à jour des variations avec embeddings...");

        // Vérifier la clé API
        if (!process.env.HUGGINGFACE_API_KEY) {
            console.error("❌ HUGGINGFACE_API_KEY manquante dans les variables d'environnement");
            process.exit(1);
        }

        // 1. Récupérer toutes les variations avec populate
        console.log("📥 Récupération des variations avec populate...");
        const variations = await Variation.find({})
            .populate('type')
            .populate('megatype')
            .exec();

        console.log(`✅ Récupéré ${variations.length} variations avec populate.`);

        // 2. Traiter chaque variation
        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;

        for (const variation of variations) {
            try {
                processedCount++;
                console.log(`\n[${processedCount}/${variations.length}] 🔄 Traitement de la variation: ${variation.name.fr}`);

                // Créer le texte mergedNames
                const mergedNames = createMergedNames(variation);

                if (!mergedNames) {
                    console.log(`  ⚠️  Données manquantes, ignoré`);
                    errorCount++;
                    continue;
                }

                console.log(`  📝 Texte généré: ${mergedNames.substring(0, 100)}...`);

                // Générer l'embedding
                console.log(`  🔄 Génération de l'embedding...`);
                const embedding = await generateEmbedding(mergedNames);

                if (!embedding) {
                    console.log(`  ❌ Échec de la génération d'embedding`);
                    errorCount++;
                    continue;
                }

                console.log(`  ✅ Embedding généré (dimension: ${embedding.length})`);

                // Mettre à jour la variation
                await Variation.updateOne(
                    { _id: variation._id },
                    {
                        $set: {
                            mergedNames: mergedNames,
                            mergedNamesEmbedding: embedding,
                            updatedAt: new Date()
                        }
                    }
                );

                successCount++;
                console.log(`  ✅ Variation mise à jour avec succès`);

                // Pause pour éviter de surcharger l'API
                if (processedCount % 5 === 0) {
                    console.log(`\n⏸️  Pause de 3 secondes pour éviter la surcharge de l'API...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }

            } catch (error) {
                console.error(`  ❌ Erreur lors du traitement de la variation ${variation.name.fr}:`, error.message);
                errorCount++;

                // Pause plus longue en cas d'erreur
                console.log(`  ⏸️  Pause de 5 secondes après erreur...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        console.log(`\n�� Traitement terminé!`);
        console.log(`�� Résumé:`);
        console.log(`  - Total traité: ${processedCount}`);
        console.log(`  - Succès: ${successCount}`);
        console.log(`  - Erreurs: ${errorCount}`);
        console.log(`  - Taux de succès: ${((successCount / processedCount) * 100).toFixed(2)}%`);

    } catch (err) {
        console.error("❌ Erreur générale:", err);
    } finally {
        // Fermer la connexion MongoDB
        await mongoose.connection.close();
        console.log("🔌 Connexion MongoDB fermée.");
    }
})(); 