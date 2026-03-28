/**
 * One-shot : recalcule brzycki / epley sur tous les seancesets (même formules que l’app).
 *
 * Usage : node oneShotQueries/backfillBrzyckiEpleyOnSeanceSets.js
 */
const mongoose = require("mongoose");
require("dotenv").config();
const SeanceSet = require("../schema/seanceset");
const { computeSetOneRepMaxEstimates } = require("../utils/oneRepMax");

const BATCH_SIZE = 500;

async function backfillBrzyckiEpleyOnSeanceSets() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    console.log("Connected to database: ", process.env.DATABASE.split('/')[1]);
    try {
        const cursor = SeanceSet.find({}).lean().cursor();
        let batch = [];
        let processed = 0;

        for await (const doc of cursor) {
            const { brzycki, epley } = computeSetOneRepMaxEstimates(doc);
            batch.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: { brzycki, epley } },
                },
            });
            processed += 1;
            if (batch.length >= BATCH_SIZE) {
                await SeanceSet.bulkWrite(batch, { ordered: false });
                batch = [];
                console.log(`… ${processed} sets traités`);
            }
        }
        if (batch.length) {
            await SeanceSet.bulkWrite(batch, { ordered: false });
        }
        console.log(`backfillBrzyckiEpleyOnSeanceSets terminé : ${processed} documents`);
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

backfillBrzyckiEpleyOnSeanceSets();
