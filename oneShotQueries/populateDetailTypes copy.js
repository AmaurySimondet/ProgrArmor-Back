const mongoose = require("mongoose");
const Detail = require("../schema/detail"); // Path to your detail model
const DetailType = require("../schema/detailtype"); // Path to your detailtype model
require("dotenv").config();

// Connect to MongoDB
mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        // Fetch all details
        const details = await Detail.find({}).exec();

        // Extract unique types
        const uniqueTypes = new Map();
        details.forEach(detail => {
            const typeFr = detail.type.fr;
            const typeEn = detail.type.en;
            const typeKey = `${typeFr}-${typeEn}`;
            if (!uniqueTypes.has(typeKey)) {
                uniqueTypes.set(typeKey, { name: { fr: typeFr, en: typeEn } });
            }
        });

        // Insert unique types into DetailType collection
        const detailTypes = Array.from(uniqueTypes.values());
        console.log("Detail types to insert:", detailTypes);
        await DetailType.insertMany(detailTypes);

        console.log("Detail types populated successfully.");
    } catch (err) {
        console.error("Error populating detail types:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();
