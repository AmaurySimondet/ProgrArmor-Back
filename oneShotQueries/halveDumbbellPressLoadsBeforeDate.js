/**
 * Divise par 2 les charges des sets d'un user avant une date donnée
 * pour les combinaisons de variations:
 * - DC haltères + haltères
 * - DM haltères + haltères
 *
 * Usage:
 * node oneShotQueries/halveDumbbellPressLoadsBeforeDate.js
 */
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const USER_ID = "6365489f44d4b4000470882b";
const DATE_LIMIT = "2026-04-22T00:00:00.000Z";
const VARIATION_DC_HALTERES = "669ced7e665a3ffe77714367";
const VARIATION_DM_HALTERES = "669ced7e665a3ffe77714369";
const VARIATION_HALTERES = "669c3609218324e0b7682aaa";

const uri = process.env.mongoURL;
const databaseName = process.env.DATABASE?.replace(/^\//, "");

if (!uri) {
    throw new Error("Missing env var: mongoURL");
}
if (!databaseName) {
    throw new Error("Missing env var: DATABASE");
}

function divideByTwoIfNumberExpr(fieldName) {
    return {
        $cond: [
            { $isNumber: `$${fieldName}` },
            { $divide: [`$${fieldName}`, 2] },
            `$${fieldName}`,
        ],
    };
}

async function run() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(databaseName);
        const seanceSets = db.collection("seancesets");

        const userId = new ObjectId(USER_ID);
        const dateLimit = new Date(DATE_LIMIT);
        const primaryVariationIds = [
            new ObjectId(VARIATION_DC_HALTERES),
            new ObjectId(VARIATION_DM_HALTERES),
        ];
        const halteresVariationId = new ObjectId(VARIATION_HALTERES);

        const filter = {
            user: userId,
            date: { $lt: dateLimit },
            variations: {
                $all: [
                    { $elemMatch: { variation: { $in: primaryVariationIds } } },
                    { $elemMatch: { variation: halteresVariationId } },
                ],
            },
        };

        const beforeCount = await seanceSets.countDocuments(filter);
        console.log(`Sets ciblés: ${beforeCount}`);

        const updateResult = await seanceSets.updateMany(filter, [
            {
                $set: {
                    weightLoad: divideByTwoIfNumberExpr("weightLoad"),
                    effectiveWeightLoad: divideByTwoIfNumberExpr("effectiveWeightLoad"),
                    effectiveWeightLoadWithBodyweight: divideByTwoIfNumberExpr("effectiveWeightLoadWithBodyweight"),
                    weightLoadLbs: divideByTwoIfNumberExpr("weightLoadLbs"),
                    effectiveWeightLoadLbs: divideByTwoIfNumberExpr("effectiveWeightLoadLbs"),
                    effectiveWeightLoadWithBodyweightLbs: divideByTwoIfNumberExpr("effectiveWeightLoadWithBodyweightLbs"),
                },
            },
        ]);

        console.log(`Matched: ${updateResult.matchedCount}`);
        console.log(`Modified: ${updateResult.modifiedCount}`);

        const preview = await seanceSets
            .find(filter, { projection: { date: 1, weightLoad: 1, effectiveWeightLoad: 1 } })
            .sort({ date: -1 })
            .limit(3)
            .toArray();
        console.log("Aperçu après update:", JSON.stringify(preview, null, 2));
    } catch (error) {
        console.error("Erreur one-shot:", error);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

run();
