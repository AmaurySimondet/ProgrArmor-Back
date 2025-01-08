const mongoose = require("mongoose");
const Categorie = require("../schema/categorieOld"); // Path to your categorie model
const CategorieType = require("../schema/categorietype"); // Path to your categorietype model
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        // Fetch all categories
        const categories = await Categorie.find({}).exec();

        for (let category of categories) {
            // Find the corresponding CategorieType
            const categorieType = await CategorieType.findOne({
                'name.fr': category.type.fr,
                'name.en': category.type.en
            }).exec();

            if (categorieType) {
                // Update the category to reference the CategorieType _id
                await Categorie.updateOne(
                    { _id: category._id },
                    {
                        $set: {
                            type: categorieType._id,
                            updatedAt: new Date()
                        }
                    }
                );
            } else {
                console.error(`No matching CategorieType found for category: ${category._id}`);
            }
        }

        console.log("Categories updated successfully.");
    } catch (err) {
        console.error("Error updating categories:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();

