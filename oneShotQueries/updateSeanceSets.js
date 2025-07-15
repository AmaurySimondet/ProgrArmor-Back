const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
const client = new MongoClient(uri);

async function updateSeanceSets() {
    try {
        await client.connect();
        const db = client.db(process.env.DATABASE.split('/')[1]);
        console.log("Connected to database: ", process.env.DATABASE.split('/')[1]);

        // Execute the aggregation pipeline to update variations
        const result = await db.collection('seancesets').updateMany(
            {},
            [
                {
                    $set: {
                        variations: {
                            $concatArrays: [
                                [
                                    {
                                        variation: "$exercice",
                                        type: "$exerciceType"
                                    }
                                ],
                                {
                                    $map: {
                                        input: "$categories",
                                        as: "cat",
                                        in: {
                                            variation: "$$cat.category",
                                            type: "$$cat.categoryType"
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
        );

        console.log(`Updated ${result.modifiedCount} documents in seancesets collection`);
        console.log('Seancesets update completed successfully');
    } catch (error) {
        console.error('Error updating seancesets:', error);
    } finally {
        await client.close();
    }
}

// Execute the function
updateSeanceSets(); 