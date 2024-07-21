const mongoose = require("mongoose");
const Exercice = require("../schema/exercice"); // Path to your exercice model
const ExerciceType = require("../schema/exercicetype"); // Path to your exercicetype model
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + "/prograrmor", {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        // Fetch all exercices
        const exercices = await Exercice.find({}).exec();
        console.log("Exercices fetched:", exercices);

        // Extract unique types
        const uniqueTypes = new Map();
        exercices.forEach(exercice => {
            const typeFr = exercice.type.fr;
            const typeEn = exercice.type.en;
            const typeKey = `${typeFr}-${typeEn}`;
            if (!uniqueTypes.has(typeKey)) {
                uniqueTypes.set(typeKey, { name: { fr: typeFr, en: typeEn } });
            }
        });

        // Insert unique types into ExerciceType collection
        const exerciceTypes = Array.from(uniqueTypes.values());
        console.log("Exercice types to insert:", exerciceTypes);
        await ExerciceType.insertMany(exerciceTypes);

        console.log("Exercice types populated successfully.");
    } catch (err) {
        console.error("Error populating exercice types:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();
