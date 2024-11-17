const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
const client = new MongoClient(uri);

async function transformSeances(userId) {
    try {
        await client.connect();
        const oldDb = client.db('prograrmortestDB');
        const newDb = client.db('prograrmor');


        const usersCollection = oldDb.collection('users');
        const seancesCollection = newDb.collection('seances');
        const seancesetsCollection = newDb.collection('seancesets');
        const exercicesCollection = newDb.collection('exercices');
        const categoriesCollection = newDb.collection('categories');

        const user = await usersCollection.findOne({ _id: userId });

        if (!user || !user.seances) {
            console.log('User or seances not found');
            return;
        }

        for (const seance of user.seances) {
            // Insert seance document
            const seanceDoc = {
                date: new Date(seance.date),
                name: seance.nom ? seance.nom.nouveauNom || seance.nom.ancienNom : null,
                createdAt: new Date(),
                updatedAt: new Date(),
                user: userId,
            };

            const seanceResult = await seancesCollection.insertOne(seanceDoc);
            const seanceId = seanceResult.insertedId;

            for (const [exerciceOrder, exerciceData] of Object.entries(seance.exercices)) {
                // Look up exercice ID
                const exerciceDoc = await exercicesCollection.findOne({ "name.fr": exerciceData.exercice.name });
                const exerciceId = exerciceDoc ? exerciceDoc._id : null;

                elastics = null;
                for (const [setOrder, setData] of Object.entries(exerciceData.Series)) {
                    // Look up category and categoryType IDs
                    const categories = [];

                    for (const category of Object.values(exerciceData.Categories || {})) {
                        if (category.name === "Elastique") {
                            elastics = {
                                // lower string
                                use: category.utilisation.toLowerCase(),
                                tension: parseFloat(category.estimation),
                            };
                        }
                        else {
                            const categoryDoc = await categoriesCollection.findOne({ "name.fr": category.input });
                            if (categoryDoc) {
                                categories.push({ category: categoryDoc._id, categoryType: categoryDoc.type });
                            }
                        }
                    }

                    const seanceSetDoc = {
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        date: new Date(seance.date),
                        user: userId,
                        exercice: exerciceId,
                        exerciceType: exerciceDoc ? exerciceDoc.type : null,
                        categories: categories,
                        seance: seanceId,
                        exerciceOrder: parseInt(exerciceOrder, 10) + 1,
                        exerciceTotal: Object.keys(seance.exercices).length,
                        setOrder: parseInt(setOrder, 10) + 1,
                        setTotal: Object.keys(exerciceData.Series).length,
                        unit: setData.typeSerie === 'reps' ? 'repetitions' : 'seconds',
                        value: parseFloat(setData.repsTime),
                        weightLoad: parseFloat(setData.charge),
                        elastic: elastics,
                    };

                    await seancesetsCollection.insertOne(seanceSetDoc);
                }
            }
        }

        console.log('Transformation completed successfully');
    } catch (error) {
        console.error('Error transforming seances:', error);
    } finally {
        await client.close();
    }
}

async function convertUsersSeances() {
    try {
        await client.connect();
        const oldDb = client.db('prograrmortestDB');
        const usersCollection = oldDb.collection('users');

        const users = await usersCollection.find({}).toArray();

        for (const user of users) {
            console.log('Transforming user:', user);
            await transformSeances(user._id);
        }
    } catch (error) {
        console.error('Error converting users seances:', error);
    } finally {
        await client.close();
    }
}

convertUsersSeances();