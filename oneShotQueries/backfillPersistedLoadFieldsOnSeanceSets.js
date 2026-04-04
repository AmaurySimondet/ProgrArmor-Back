/**
 * One-shot : remplit effectiveWeightLoad, weightLoadLbs, effectiveWeightLoadLbs, brzycki, epley
 * sur tous les seancesets (formules alignées avec utils/oneRepMax.js + facteur kg→lb).
 *
 * Usage : node oneShotQueries/backfillPersistedLoadFieldsOnSeanceSets.js
 */
const mongoose = require("mongoose");
require("dotenv").config();
const SeanceSet = require("../schema/seanceset");
const { computeSetOneRepMaxEstimates, getEffectiveLoadKg } = require("../utils/oneRepMax");
const { KG_TO_LB, round2 } = require("../utils/seanceSetPersistedFields");

const BATCH_SIZE = 500;

async function backfillPersistedLoadFieldsOnSeanceSets() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    console.log("Connected to database: ", process.env.DATABASE.split("/")[1]);
    try {
        const cursor = SeanceSet.find({}).lean().cursor();
        let batch = [];
        let processed = 0;

        for await (const doc of cursor) {
            const { brzycki, epley } = computeSetOneRepMaxEstimates(doc);
            const effectiveWeightLoad = round2(getEffectiveLoadKg(doc));
            const wl = doc.weightLoad;
            const weightLoadLbs =
                wl != null && Number.isFinite(Number(wl)) ? round2(Number(wl) * KG_TO_LB) : null;
            const effectiveWeightLoadLbs =
                effectiveWeightLoad != null ? round2(effectiveWeightLoad * KG_TO_LB) : null;

            batch.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: {
                        $set: {
                            brzycki,
                            epley,
                            effectiveWeightLoad,
                            weightLoadLbs,
                            effectiveWeightLoadLbs,
                        },
                    },
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
        console.log(`backfillPersistedLoadFieldsOnSeanceSets terminé : ${processed} documents`);
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

backfillPersistedLoadFieldsOnSeanceSets();
