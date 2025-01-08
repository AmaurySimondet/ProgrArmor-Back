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
        // Fetch all detail types
        const detailTypes = await DetailType.find({}).exec();
        console.log(`Found ${detailTypes.length} detail types.`);

        for (let detailType of detailTypes) {
            // Find up to three example details for this detail type
            const examples = await Detail.find({ type: detailType._id })
                .limit(3)
                .exec();

            if (examples.length > 0) {
                // Extract the IDs of the examples
                const exampleFr = examples.map(example => example.name.fr);
                const exampleEn = examples.map(example => example.name.en);

                // Update the detail type with the examples
                const updateResult = await DetailType.updateOne(
                    { _id: detailType._id },
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

                console.log(`Update result for DetailType ${detailType._id}:`, updateResult);
            } else {
                console.log(`No examples found for DetailType ${detailType._id}`);
            }
        }

        console.log("Detail types updated with examples successfully.");
    } catch (err) {
        console.error("Error updating detail types:", err);
    } finally {
        // Close the MongoDB connection
        await mongoose.connection.close();
    }
})();
