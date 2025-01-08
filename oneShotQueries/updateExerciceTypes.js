const mongoose = require("mongoose");
const Exercice = require("../schema/exercice"); // Path to your exercice model
const ExerciceType = require("../schema/exercicetype"); // Path to your exercicetype model
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        // Fetch all exercice types
        const exerciceTypes = await ExerciceType.find({}).exec();
        console.log(`Found ${exerciceTypes.length} exercice types.`);

        for (let exerciceType of exerciceTypes) {
            // Find up to three example exercices for this exercice type
            const examples = await Exercice.find({ type: exerciceType._id })
                .limit(3)
                .exec();

            if (examples.length > 0) {
                // Extract the IDs of the examples
                const exampleFr = examples.map(example => example.name.fr);
                const exampleEn = examples.map(example => example.name.en);

                // Update the exercice type with the examples
                const updateResult = await ExerciceType.updateOne(
                    { _id: exerciceType._id },
                    {
                        $set: {
                            examples: {
                                fr: exampleFr,
                                en: exampleEn
                            },
                            updatedAt: new Date()
                        }
                    }
                );

                console.log(`Update result for ExerciceType ${exerciceType._id}:`, updateResult);
            } else {
                console.log(`No examples found for ExerciceType ${exerciceType._id}`);
            }
        }

        console.log("Exercice types updated with examples successfully.");
    } catch (err) {
        console.error("Error updating exercice types:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();
