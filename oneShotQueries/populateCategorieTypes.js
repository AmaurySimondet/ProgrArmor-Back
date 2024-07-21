const mongoose = require("mongoose");
const Categorie = require("../schema/categorieOld"); // Path to your categorie model
const CategorieType = require("../schema/categorietype"); // Path to your categorietype model
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + "/prograrmor", {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        // Fetch all categories
        const categories = await Categorie.find({}).exec();

        // Extract unique types
        const uniqueTypes = new Map();
        categories.forEach(category => {
            const typeFr = category.type.fr;
            const typeEn = category.type.en;
            const typeKey = `${typeFr}-${typeEn}`;
            if (!uniqueTypes.has(typeKey)) {
                uniqueTypes.set(typeKey, { name: { fr: typeFr, en: typeEn } });
            }
        });

        // Insert unique types into CategorieType collection
        const categorieTypes = Array.from(uniqueTypes.values());
        console.log("Categorie types to insert:", categorieTypes);
        await CategorieType.insertMany(categorieTypes);

        console.log("Categorie types populated successfully.");
    } catch (err) {
        console.error("Error populating categorie types:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();
