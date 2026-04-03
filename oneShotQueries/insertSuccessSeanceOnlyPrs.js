/**
 * One-shot : publie le succès secret « En légende » / « Aura Farmer »
 * (au moins 4 séries, toutes PR — voir `seance_only_prs` dans lib/success.js).
 *
 * Usage : node oneShotQueries/insertSuccessSeanceOnlyPrs.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Success = require("../schema/success");

const SUCCESS_PICTURE_CDN_BASE = "https://d28n1fykqesg8f.cloudfront.net/successes";

const DOC = {
    type: "secret",
    level: 4,
    name: { fr: "En légende", en: "Aura Farmer" },
    description: {
        fr: "Faire une séance d'au moins 4 séries composée uniquement de PRs",
        en: "Complete a workout of at least 4 sets made only of PRs",
    },
    hint: {
        fr: "Une séance légendaire...",
        en: "A legendary workout...",
    },
    picture: {
        fr: `${SUCCESS_PICTURE_CDN_BASE}/smoke.png`,
        en: `${SUCCESS_PICTURE_CDN_BASE}/smoke.png`,
    },
    condition: {
        condition_code: "seance_only_prs",
        collection: "seancesets",
        howMany: 4,
    },
};

async function run() {
    const mongoURL = process.env.mongoURL;
    const DATABASE = process.env.DATABASE;
    if (!mongoURL || !DATABASE) {
        throw new Error("mongoURL / DATABASE env variables are required");
    }

    await mongoose.connect(mongoURL + DATABASE);
    try {
        const res = await Success.updateOne(
            {
                type: DOC.type,
                level: DOC.level,
                "name.fr": DOC.name.fr,
            },
            {
                $set: DOC,
                $setOnInsert: { howManyUsersHaveIt: 0 },
            },
            { upsert: true }
        );
        console.log(
            JSON.stringify(
                {
                    matched: res.matchedCount,
                    modified: res.modifiedCount,
                    upserted: res.upsertedCount ? String(res.upsertedId) : null,
                },
                null,
                2
            )
        );
        const saved = await Success.findOne({
            type: DOC.type,
            level: DOC.level,
            "name.fr": DOC.name.fr,
        })
            .select("_id condition")
            .lean();
        console.log("stored:", saved);
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error("[insertSuccessSeanceOnlyPrs]", err);
    process.exit(1);
});
