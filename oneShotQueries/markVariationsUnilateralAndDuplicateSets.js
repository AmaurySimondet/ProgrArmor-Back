/**
 * Usage:
 *   # Dry-run (par défaut)
 *   VARIATION_IDS=id1,id2,id3 node oneShotQueries/markVariationsUnilateralAndDuplicateSets.js
 *
 *   # Apply
 *   APPLY=1 VARIATION_IDS=id1,id2,id3 node oneShotQueries/markVariationsUnilateralAndDuplicateSets.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");
const SeanceSet = require("../schema/seanceset");

const APPLY = process.env.APPLY === "1";
const BATCH_SIZE = 300;

const DEFAULT_VARIATION_IDS = [];
const ENV_IDS = (process.env.VARIATION_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const TARGET_IDS = [...new Set([...DEFAULT_VARIATION_IDS, ...ENV_IDS])];

function computeDuplicatedOrder(sourceSetOrder, side) {
    const n = Number(sourceSetOrder);
    if (!Number.isFinite(n)) return sourceSetOrder;
    return side === "left" ? (2 * n) - 1 : 2 * n;
}

function buildClone(sourceDoc, side) {
    const clone = { ...sourceDoc };
    delete clone._id;
    delete clone.createdAt;
    delete clone.updatedAt;
    clone.isUnilateral = true;
    clone.unilateralSide = side;
    clone.setOrder = computeDuplicatedOrder(sourceDoc.setOrder, side);
    if (Number.isFinite(Number(sourceDoc.setTotal))) {
        clone.setTotal = Number(sourceDoc.setTotal) * 2;
    }
    return clone;
}

async function run() {
    if (!TARGET_IDS.length) {
        throw new Error("Aucune variation fournie. Utilise VARIATION_IDS=id1,id2,...");
    }

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        const variationObjectIds = TARGET_IDS.map((id) => new mongoose.Types.ObjectId(id));

        const existingVariations = await Variation.find(
            { _id: { $in: variationObjectIds } },
            { _id: 1, isUnilateral: 1, name: 1 }
        ).lean();
        const existingIdSet = new Set(existingVariations.map((v) => v._id.toString()));
        const missingVariationIds = TARGET_IDS.filter((id) => !existingIdSet.has(id));

        console.log("=== markVariationsUnilateralAndDuplicateSets ===");
        console.log("Mode:", APPLY ? "APPLY" : "DRY_RUN");
        console.log("Variation IDs reçus:", TARGET_IDS.length);
        console.log("Variations trouvées:", existingVariations.length);
        console.log("Variation IDs manquants:", missingVariationIds.length);
        if (missingVariationIds.length) {
            console.log("missingVariationIds:", missingVariationIds);
        }

        if (APPLY) {
            const updateVariationsRes = await Variation.updateMany(
                { _id: { $in: variationObjectIds } },
                { $set: { isUnilateral: true } }
            );
            console.log("Variations matched:", updateVariationsRes.matchedCount);
            console.log("Variations modified:", updateVariationsRes.modifiedCount);
        } else {
            const toUpdateCount = await Variation.countDocuments({
                _id: { $in: variationObjectIds },
                isUnilateral: { $ne: true },
            });
            console.log("Variations à passer isUnilateral=true:", toUpdateCount);
        }

        const sourceQuery = {
            "variations.variation": { $in: variationObjectIds },
            $and: [
                {
                    $or: [
                        { isUnilateral: { $exists: false } },
                        { isUnilateral: false },
                        { isUnilateral: null },
                    ],
                },
                {
                    $or: [
                        { unilateralSide: { $exists: false } },
                        { unilateralSide: null },
                    ],
                },
            ],
        };

        const sourceCount = await SeanceSet.countDocuments(sourceQuery);
        console.log("Sets source détectés:", sourceCount);

        const cursor = sourceCount > 0 ? SeanceSet.find(sourceQuery).lean().cursor() : null;
        let processed = 0;
        let inserted = 0;
        let deletedSources = 0;
        let insertBatch = [];
        let deleteSourceIdsBatch = [];

        if (cursor) {
            for await (const sourceSet of cursor) {
                processed += 1;
                insertBatch.push(buildClone(sourceSet, "left"));
                insertBatch.push(buildClone(sourceSet, "right"));
                deleteSourceIdsBatch.push(sourceSet._id);

                if (insertBatch.length >= BATCH_SIZE * 2) {
                    if (APPLY) {
                        const docs = await SeanceSet.insertMany(insertBatch, { ordered: false });
                        inserted += docs.length;
                        const deleteRes = await SeanceSet.deleteMany({ _id: { $in: deleteSourceIdsBatch } });
                        deletedSources += deleteRes.deletedCount || 0;
                    } else {
                        inserted += insertBatch.length;
                        deletedSources += deleteSourceIdsBatch.length;
                    }
                    insertBatch = [];
                    deleteSourceIdsBatch = [];
                }
            }

            if (insertBatch.length) {
                if (APPLY) {
                    const docs = await SeanceSet.insertMany(insertBatch, { ordered: false });
                    inserted += docs.length;
                    const deleteRes = await SeanceSet.deleteMany({ _id: { $in: deleteSourceIdsBatch } });
                    deletedSources += deleteRes.deletedCount || 0;
                } else {
                    inserted += insertBatch.length;
                    deletedSources += deleteSourceIdsBatch.length;
                }
            }
        }

        console.log("=== Résumé sets ===");
        console.log("Sources traités:", processed);
        console.log(`Duplicats ${APPLY ? "insérés" : "prévus"}:`, inserted);
        console.log(`Sources ${APPLY ? "supprimés" : "à supprimer"}:`, deletedSources);

        const normalizeQuery = {
            $or: [
                { isUnilateral: { $exists: false } },
                { isUnilateral: null },
            ],
        };
        const toNormalize = await SeanceSet.countDocuments(normalizeQuery);
        if (APPLY) {
            const normalizeRes = await SeanceSet.updateMany(
                normalizeQuery,
                { $set: { isUnilateral: false } }
            );
            console.log("Sets normalisés isUnilateral=false:", normalizeRes.modifiedCount || 0);
        } else {
            console.log("Sets à normaliser isUnilateral=false:", toNormalize);
        }

        if (!APPLY) {
            console.log("Dry-run terminé. Pour appliquer:");
            console.log("APPLY=1 VARIATION_IDS=id1,id2,... node oneShotQueries/markVariationsUnilateralAndDuplicateSets.js");
        }
    } finally {
        await mongoose.connection.close();
    }
}

run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
