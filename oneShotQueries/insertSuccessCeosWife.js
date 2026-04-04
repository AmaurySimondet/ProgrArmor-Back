/**
 * One-shot : succès secret « Femme du PDG » / « CEO's wife » (user_id, même logique que « PDG »).
 *
 * Usage : node oneShotQueries/insertSuccessCeosWife.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Success = require("../schema/success");

const SUCCESS_PICTURE_CDN_BASE = "https://d28n1fykqesg8f.cloudfront.net/successes";

const CEO_WIFE_USER_ID = "678801d2032ab300037b8046";

const DOC = {
    type: "secret",
    level: 5,
    name: { fr: "Femme du PDG", en: "CEO's wife" },
    description: {
        fr: "Être elle",
        en: "Be her",
    },
    hint: {
        fr: "Être la femme du PDG de ProgArmor",
        en: "Be ProgArmor's CEO's wife",
    },
    picture: {
        fr: `${SUCCESS_PICTURE_CDN_BASE}/unicorn.png`,
        en: `${SUCCESS_PICTURE_CDN_BASE}/unicorn.png`,
    },
    condition: {
        condition_code: "user_id",
        collection: "user",
        field: "_id",
        userId: new mongoose.Types.ObjectId(CEO_WIFE_USER_ID),
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
        const filter = {
            type: DOC.type,
            level: DOC.level,
            "name.fr": DOC.name.fr,
        };
        const existing = await Success.findOne(filter).select("condition").lean();
        const conditionChanged =
            !existing || JSON.stringify(existing.condition) !== JSON.stringify(DOC.condition);

        const res = await Success.updateOne(
            filter,
            {
                $set: {
                    ...DOC,
                    ...(conditionChanged ? { conditionUpdatedAt: new Date() } : {}),
                },
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
        const saved = await Success.findOne(filter)
            .select("_id condition conditionUpdatedAt")
            .lean();
        console.log("stored:", saved);
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error("[insertSuccessCeosWife]", err);
    process.exit(1);
});
