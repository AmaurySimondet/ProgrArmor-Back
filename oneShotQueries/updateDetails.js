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

        for (let detail of details) {
            // Find the corresponding DetailType
            const detailType = await DetailType.findOne({
                'name.fr': detail.type.fr,
                'name.en': detail.type.en
            }).exec();

            if (detailType) {
                // Update the detail to reference the DetailType _id
                await Detail.updateOne(
                    { _id: detail._id },
                    {
                        $set: {
                            type: detailType._id,
                            updatedAt: new Date()
                        }
                    }
                );
            } else {
                console.error(`No matching DetailType found for detail: ${detail._id}`);
            }
        }

        console.log("Details updated successfully.");
    } catch (err) {
        console.error("Error updating details:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();

