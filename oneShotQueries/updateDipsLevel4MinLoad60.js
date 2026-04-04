/**
 * Passe le succès dips (Le piston) niveau 4 : PR min 50kg → 60kg.
 * _id fixé : 69ce75a6cf5bb9dd2c13a169
 *
 * Usage : node oneShotQueries/updateDipsLevel4MinLoad60.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Success = require("../schema/success");

const SUCCESS_ID = "69ce75a6cf5bb9dd2c13a169";

/** Filtre de secours : dips famille, niveau catalogue (CSV « Le piston » niveau 4) */
const FALLBACK_FILTER = {
    type: "exercise",
    level: 4,
    "name.fr": "Le piston",
    "condition.condition_code": "exercise_pr_weight",
};

async function run() {
    const mongoURL = process.env.mongoURL;
    const DATABASE = process.env.DATABASE;
    if (!mongoURL || !DATABASE) {
        throw new Error("mongoURL / DATABASE env variables are required");
    }

    await mongoose.connect(mongoURL + DATABASE);
    try {
        let filter = { _id: new mongoose.Types.ObjectId(SUCCESS_ID) };
        let before = await Success.findOne(filter).select("name level condition").lean();
        if (!before) {
            console.warn(`Aucun document pour _id=${SUCCESS_ID}, tentative filtre dips niveau 4…`);
            filter = FALLBACK_FILTER;
            before = await Success.findOne(filter).select("name level condition").lean();
        }
        console.log("before:", JSON.stringify(before, null, 2));
        if (!before) {
            throw new Error("Succès introuvable (id ni filtre de secours). Vérifie DATABASE / _id.");
        }

        const res = await Success.updateOne(filter, {
            $set: {
                "condition.effectiveWeightLoadMin": 60,
                conditionUpdatedAt: new Date(),
            },
        });
        console.log("updateOne:", { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount });

        const afterId = before._id;
        const after = await Success.findById(afterId).select("name level condition conditionUpdatedAt").lean();
        console.log("after:", JSON.stringify(after, null, 2));
    } finally {
        await mongoose.disconnect();
    }
}

run().catch(err => {
    console.error("[updateDipsLevel4MinLoad60]", err);
    process.exit(1);
});
