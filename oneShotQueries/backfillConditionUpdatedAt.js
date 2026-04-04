/**
 * Renseigne conditionUpdatedAt sur Success et conditionSyncedAt sur UserSuccess
 * pour les documents créés avant ces champs.
 *
 * Success : conditionUpdatedAt = createdAt (référence « définition initiale »).
 * UserSuccess : conditionSyncedAt = createdAt (déblocage validé pour cette ligne de temps).
 *
 * Usage : node oneShotQueries/backfillConditionUpdatedAt.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Success = require("../schema/success");
const UserSuccess = require("../schema/usersuccess");

async function run() {
    const mongoURL = process.env.mongoURL;
    const DATABASE = process.env.DATABASE;
    if (!mongoURL || !DATABASE) {
        throw new Error("mongoURL / DATABASE env variables are required");
    }

    await mongoose.connect(mongoURL + DATABASE);
    try {
        const successRes = await Success.updateMany(
            { $or: [{ conditionUpdatedAt: { $exists: false } }, { conditionUpdatedAt: null }] },
            [{ $set: { conditionUpdatedAt: "$createdAt" } }]
        );
        console.log("Success updated:", { matchedCount: successRes.matchedCount, modifiedCount: successRes.modifiedCount });

        const usRes = await UserSuccess.updateMany(
            { $or: [{ conditionSyncedAt: { $exists: false } }, { conditionSyncedAt: null }] },
            [{ $set: { conditionSyncedAt: "$createdAt" } }]
        );
        console.log("UserSuccess updated:", { matchedCount: usRes.matchedCount, modifiedCount: usRes.modifiedCount });
    } finally {
        await mongoose.disconnect();
    }
}

run().catch(err => {
    console.error("[backfillConditionUpdatedAt]", err);
    process.exit(1);
});
