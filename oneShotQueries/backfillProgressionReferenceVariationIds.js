/**
 * Backfill progressionReferenceVariationId + possibleProgression (true) for selected progression families.
 *
 * Usage:
 *   node oneShotQueries/backfillProgressionReferenceVariationIds.js
 *   node oneShotQueries/backfillProgressionReferenceVariationIds.js --apply
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");

const L_SIT_ID = "669ced7e665a3ffe7771438a";
const V_SIT_ID = "669ced7e665a3ffe7771438b";
const MANNA_ID = "669ced7e665a3ffe7771438c";

const PUSHUP_KNEES_ID = "692214521c858345acc2d34f";
const PUSHUP_ID = "669ced7e665a3ffe7771437a";
const PUSHUP_ARCHER_ID = "692214501c858345acc2d27c";
const PUSHUP_ONE_ARM_ASSISTED_ID = "69fc6498bb3b26c6dcf898f5";
const PUSHUP_ONE_ARM_ID = "6922144c1c858345acc2d095";

const PULLUP_ID = "669ced7e665a3ffe77714379";
const PULLUP_ARCHER_ID = "692214531c858345acc2d3a6";
const PULLUP_ONE_ARM_ASSISTED_ID = "692214531c858345acc2d3af";
const PULLUP_ONE_ARM_ID = "6922144d1c858345acc2d138";

const DIPS_ID = "669ced7e665a3ffe7771437b";

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }
    return mongoUrl + database;
}

function oid(id) {
    return new mongoose.Types.ObjectId(id);
}

const PLAN = [
    // L-Sit family
    { targetId: L_SIT_ID, referenceId: L_SIT_ID, label: "L-Sit -> L-Sit" },
    { targetId: V_SIT_ID, referenceId: L_SIT_ID, label: "V-Sit -> L-Sit" },
    { targetId: MANNA_ID, referenceId: L_SIT_ID, label: "Manna -> L-Sit" },

    // Push-up family
    { targetId: PUSHUP_KNEES_ID, referenceId: PUSHUP_KNEES_ID, label: "Knee Push-Ups -> Knee Push-Ups" },
    { targetId: PUSHUP_ID, referenceId: PUSHUP_KNEES_ID, label: "Push Ups -> Knee Push-Ups" },
    { targetId: PUSHUP_ARCHER_ID, referenceId: PUSHUP_KNEES_ID, label: "Archer Push Ups -> Knee Push-Ups" },
    { targetId: PUSHUP_ONE_ARM_ASSISTED_ID, referenceId: PUSHUP_KNEES_ID, label: "One Arm Push-Ups (Assisted) -> Knee Push-Ups" },
    { targetId: PUSHUP_ONE_ARM_ID, referenceId: PUSHUP_KNEES_ID, label: "One Arm Push Ups -> Knee Push-Ups" },

    // Pull-up family
    { targetId: PULLUP_ID, referenceId: PULLUP_ID, label: "Pull Ups -> Pull Ups" },
    { targetId: PULLUP_ARCHER_ID, referenceId: PULLUP_ID, label: "Archer Pull-Up -> Pull Ups" },
    { targetId: PULLUP_ONE_ARM_ASSISTED_ID, referenceId: PULLUP_ID, label: "One Arm Pull-Up (Assisted) -> Pull Ups" },
    { targetId: PULLUP_ONE_ARM_ID, referenceId: PULLUP_ID, label: "One Arm Pull Ups -> Pull Ups" },

    // Dips family (base exercise; archer/one-arm use detail categories until dedicated exercise rows exist)
    { targetId: DIPS_ID, referenceId: DIPS_ID, label: "Dips -> Dips" }
];

async function run() {
    const shouldApply = process.argv.includes("--apply");
    await mongoose.connect(getMongoUri());

    const allIds = [...new global.Set(PLAN.flatMap((x) => [x.targetId, x.referenceId]))];
    const docs = await Variation.find(
        { _id: { $in: allIds.map((id) => oid(id)) } },
        { _id: 1, name: 1, progressionReferenceVariationId: 1, possibleProgression: 1, isExercice: 1 }
    ).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const missing = allIds.filter((id) => !byId.has(id));

    console.log("=== Backfill progressionReferenceVariationId ===");
    console.log({ applyMode: shouldApply, planCount: PLAN.length, foundVariations: docs.length, missingIds: missing });

    const preview = PLAN.map((step) => {
        const target = byId.get(step.targetId);
        const reference = byId.get(step.referenceId);
        const currentRef = target?.progressionReferenceVariationId
            ? String(target.progressionReferenceVariationId)
            : null;
        return {
            label: step.label,
            targetId: step.targetId,
            targetNameFr: target?.name?.fr || null,
            referenceId: step.referenceId,
            referenceNameFr: reference?.name?.fr || null,
            currentReferenceId: currentRef,
            currentPossibleProgression: target?.possibleProgression,
            needsUpdate: currentRef !== step.referenceId || target?.possibleProgression !== true
        };
    });
    console.log(preview);

    if (shouldApply) {
        let updated = 0;
        for (const step of PLAN) {
            if (!byId.has(step.targetId) || !byId.has(step.referenceId)) continue;
            const result = await Variation.updateOne(
                {
                    _id: oid(step.targetId),
                    $or: [
                        { progressionReferenceVariationId: { $ne: oid(step.referenceId) } },
                        { possibleProgression: { $ne: true } }
                    ]
                },
                {
                    $set: {
                        progressionReferenceVariationId: oid(step.referenceId),
                        possibleProgression: true
                    }
                }
            );
            updated += result.modifiedCount || 0;
        }
        console.log("=== Apply Result ===");
        console.log({ updated });
    } else {
        console.log("Dry-run only. Use --apply to persist.");
    }
}

run()
    .catch(async (err) => {
        console.error("backfillProgressionReferenceVariationIds failed:", err);
        process.exitCode = 1;
        try { await mongoose.disconnect(); } catch (_) {}
    })
    .finally(async () => {
        try { await mongoose.disconnect(); } catch (_) {}
    });
