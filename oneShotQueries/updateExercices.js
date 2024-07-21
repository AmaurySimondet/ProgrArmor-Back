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

        for (let exercice of exercices) {
            // Find the corresponding ExerciceType
            const exerciceType = await ExerciceType.findOne({
                'name.fr': exercice.type.fr,
                'name.en': exercice.type.en
            }).exec();

            if (exerciceType) {
                // Update the exercice to reference the ExerciceType _id
                await Exercice.updateOne(
                    { _id: exercice._id },
                    {
                        $set: {
                            type: exerciceType._id,
                            updatedAt: new Date()
                        }
                    }
                );
            } else {
                console.error(`No matching ExerciceType found for exercice: ${exercice._id}`);
            }
        }

        console.log("Exercices updated successfully.");
    } catch (err) {
        console.error("Error updating exercices:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();

