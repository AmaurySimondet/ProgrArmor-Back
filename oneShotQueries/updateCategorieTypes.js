const mongoose = require("mongoose");
const Categorie = require("../schema/categorie"); // Path to your categorie model
const CategorieType = require("../schema/categorietype"); // Path to your categorietype model
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        // Fetch all categorie types
        const categorieTypes = await CategorieType.find({}).exec();
        console.log(`Found ${categorieTypes.length} categorie types.`);

        for (let categorieType of categorieTypes) {
            // Find up to three example categories for this categorie type
            const examples = await Categorie.find({ type: categorieType._id })
                .limit(3)
                .exec();

            if (examples.length > 0) {
                // Extract the IDs of the examples
                const exampleFr = examples.map(example => example.name.fr);
                const exampleEn = examples.map(example => example.name.en);

                // Update the categorie type with the examples
                const updateResult = await CategorieType.updateOne(
                    { _id: categorieType._id },
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

                console.log(`Update result for CategorieType ${categorieType._id}:`, updateResult);
            } else {
                console.log(`No examples found for CategorieType ${categorieType._id}`);
            }
        }

        console.log("Categorie types updated with examples successfully.");
    } catch (err) {
        console.error("Error updating categorie types:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();
