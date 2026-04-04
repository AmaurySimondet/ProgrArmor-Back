/**
 * Migre condition.userId (succès user_id) de string → ObjectId si besoin.
 *
 * Usage : node oneShotQueries/migrateSuccessUserIdToObjectId.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Success = require("../schema/success");

async function run() {
    const mongoURL = process.env.mongoURL;
    const DATABASE = process.env.DATABASE;
    if (!mongoURL || !DATABASE) {
        throw new Error("mongoURL / DATABASE env variables are required");
    }

    await mongoose.connect(mongoURL + DATABASE);
    try {
        const docs = await Success.find({
            "condition.condition_code": "user_id",
            "condition.userId": { $type: "string" },
        })
            .select("_id condition")
            .lean();

        let updated = 0;
        for (const doc of docs) {
            const raw = doc.condition?.userId;
            if (typeof raw !== "string" || !mongoose.Types.ObjectId.isValid(raw)) continue;
            await Success.updateOne(
                { _id: doc._id },
                {
                    $set: {
                        "condition.userId": new mongoose.Types.ObjectId(raw),
                        conditionUpdatedAt: new Date(),
                    },
                }
            );
            updated += 1;
            console.log(`updated ${doc._id} userId string → ObjectId`);
        }
        console.log(JSON.stringify({ matchedStringUserId: docs.length, updated }, null, 2));
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error("[migrateSuccessUserIdToObjectId]", err);
    process.exit(1);
});
