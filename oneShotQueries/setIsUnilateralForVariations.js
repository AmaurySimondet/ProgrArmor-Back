/**
 * Usage:
 *   node oneShotQueries/setIsUnilateralForVariations.js
 *
 * Action:
 *   - Set isUnilateral=true for:
 *     1) all variations of type 669cda3b33e75a33610be153
 *     2) explicit variation IDs listed below
 *     3) all exercises where name.fr contains "haltère" and isUnilateral is null
 *   - Prints a "possible missing unilateral variations" report based on name keywords.
 */
const mongoose = require("mongoose");
require("dotenv").config();
const Variation = require("../schema/variation");

const TARGET_TYPE_ID = "669cda3b33e75a33610be153";
const EXTRA_VARIATION_IDS = [
    "669c3609218324e0b7682aaa",
    "6922144c1c858345acc2d07c", // Curl marteau
    "692214511c858345acc2d2b4", // Curl marteau incliné
    "6922144f1c858345acc2d1d6",
    "6922144f1c858345acc2d1fb",
    "692214511c858345acc2d302",
    "692214511c858345acc2d2cf",
    "692214511c858345acc2d2d8",
    "692214511c858345acc2d2fc",
    "6922144c1c858345acc2d095",
    "6922144d1c858345acc2d138",
    "692214531c858345acc2d3af",
    "692214531c858345acc2d3b2",
    "692214531c858345acc2d3cd", // Pistol squat assisté
    "692214531c858345acc2d3d0", // Dragon pistol squat
    "692214531c858345acc2d3d3", // Shrimp squat
    "692214541c858345acc2d420",
    "692214541c858345acc2d408",
];

const AUTO_DETECTED_EXTRA_IDS = [
    "669c3609218324e0b7682b30",
    "669c3609218324e0b7682b2e",
    "669c3609218324e0b7682b32",
    "6922144e1c858345acc2d14f",
    "6922144f1c858345acc2d1b8",
    "6922144f1c858345acc2d1fe",
    "692214501c858345acc2d229",
    "692214501c858345acc2d26d",
    "692214511c858345acc2d2c9",
    "692214531c858345acc2d3d6",
    "692214531c858345acc2d3dc",
];

const FORCE_FALSE_VARIATION_IDS = [
    "6922144d1c858345acc2d0e4", // Soulevé de terre roumain haltères
    "6922144e1c858345acc2d15b", // Squat haltères
    "6922144e1c858345acc2d197", // Soulevé de terre haltères
    "6922144e1c858345acc2d19d", // Extension mollets haltères
    "692214511c858345acc2d2ff", // Squat avant haltères
    "692214521c858345acc2d326", // Thuster haltères
    "692214521c858345acc2d335", // Extension mollets marchés haltères
];

const UNILATERAL_NAME_REGEX = /(unilat|single[- ]?arm|single[- ]?leg|one[- ]?arm|one[- ]?leg|une jambe|a une jambe|à une jambe|a un bras|à un bras)/i;
const DUMBBELL_FR_REGEX = /haltère/i;

async function run() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        const byType = await Variation.find({ type: TARGET_TYPE_ID }, { _id: 1 }).lean();
        const byTypeIds = byType.map((doc) => doc._id.toString());
        const dumbbellExerciseCandidates = await Variation.find(
            { "name.fr": DUMBBELL_FR_REGEX, isUnilateral: null, isExercice: true },
            { _id: 1 }
        ).lean();
        const dumbbellExerciseIds = dumbbellExerciseCandidates.map((doc) => doc._id.toString());

        const forceFalseSet = new Set(FORCE_FALSE_VARIATION_IDS);
        const targetIds = [
            ...new Set([
                ...byTypeIds,
                ...EXTRA_VARIATION_IDS,
                ...AUTO_DETECTED_EXTRA_IDS,
                ...dumbbellExerciseIds,
            ]),
        ].filter((id) => !forceFalseSet.has(id));

        const targetObjectIds = targetIds.map((id) => new mongoose.Types.ObjectId(id));
        const forceFalseObjectIds = FORCE_FALSE_VARIATION_IDS.map((id) => new mongoose.Types.ObjectId(id));

        const existingTargets = await Variation.find(
            { _id: { $in: targetObjectIds } },
            { _id: 1, type: 1, name: 1, isUnilateral: 1 }
        ).lean();

        const existingIdSet = new Set(existingTargets.map((v) => v._id.toString()));
        const missingExplicitIds = [...EXTRA_VARIATION_IDS, ...AUTO_DETECTED_EXTRA_IDS].filter(
            (id) => !existingIdSet.has(id)
        );

        const updateRes = await Variation.updateMany(
            { _id: { $in: targetObjectIds } },
            { $set: { isUnilateral: true } }
        );
        const forceFalseRes = await Variation.updateMany(
            { _id: { $in: forceFalseObjectIds } },
            { $set: { isUnilateral: false } }
        );

        const keywordCandidates = await Variation.find(
            {
                $or: [
                    { "name.fr": { $regex: UNILATERAL_NAME_REGEX } },
                    { "name.en": { $regex: UNILATERAL_NAME_REGEX } },
                ],
            },
            { _id: 1, type: 1, name: 1, isUnilateral: 1 }
        ).lean();

        const targetIdSet = new Set(targetIds);
        const possibleMissing = keywordCandidates.filter(
            (v) => !targetIdSet.has(v._id.toString())
        );

        console.log("=== setIsUnilateralForVariations ===");
        console.log("Type cible:", TARGET_TYPE_ID);
        console.log("Variations trouvees dans ce type:", byTypeIds.length);
        console.log("IDs explicites fournis:", EXTRA_VARIATION_IDS.length);
        console.log("IDs auto-detectes ajoutes:", AUTO_DETECTED_EXTRA_IDS.length);
        console.log("Exercices 'haltère' (isUnilateral=null) ajoutes:", dumbbellExerciseIds.length);
        console.log("IDs forcés isUnilateral=false:", FORCE_FALSE_VARIATION_IDS.length);
        console.log("IDs explicites manquants en base:", missingExplicitIds.length);
        if (missingExplicitIds.length) {
            console.log("missingExplicitIds:", missingExplicitIds);
        }
        console.log("Total variations cibles (union):", targetIds.length);
        console.log("Matched count:", updateRes.matchedCount);
        console.log("Modified count:", updateRes.modifiedCount);
        console.log("Forced false matched count:", forceFalseRes.matchedCount);
        console.log("Forced false modified count:", forceFalseRes.modifiedCount);

        console.log("\nPossible oublis (candidats par nom, a verifier manuellement):");
        console.log("Count:", possibleMissing.length);
        for (const c of possibleMissing) {
            console.log(
                JSON.stringify(
                    {
                        _id: c._id.toString(),
                        type: c.type ? c.type.toString() : null,
                        name: c.name,
                        isUnilateral: c.isUnilateral === true,
                    },
                    null,
                    2
                )
            );
        }
    } finally {
        await mongoose.connection.close();
    }
}

run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});

