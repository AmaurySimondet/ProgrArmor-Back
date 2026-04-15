/**
 * Backfill: remplace les sets "source" par 2 sets unilatéraux (left + right).
 *
 * Règle source:
 * - set contenant au moins une variation marquée isUnilateral=true
 * - set non unilatéral (isUnilateral false/null/absent)
 * - unilateralSide null/absent
 *
 * Transformation:
 * - suppression du set source
 * - création de 2 sets:
 *   - left  => setOrder = 2 * source.setOrder - 1
 *   - right => setOrder = 2 * source.setOrder
 *
 * Usage:
 * - Dry-run (par défaut): node oneShotQueries/backfillDuplicateUnilateralSets.js
 * - Apply: APPLY=1 node oneShotQueries/backfillDuplicateUnilateralSets.js
 */
const mongoose = require("mongoose");
require("dotenv").config();
const Variation = require("../schema/variation");
const SeanceSet = require("../schema/seanceset");

const BATCH_SIZE = 300;
const APPLY = process.env.APPLY === "1";

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

async function backfillDuplicateUnilateralSets() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        const unilateralVariations = await Variation.find(
            { isUnilateral: true },
            { _id: 1 }
        ).lean();
        const unilateralVariationIds = unilateralVariations.map((v) => v._id);

        if (!unilateralVariationIds.length) {
            console.log("Aucune variation isUnilateral=true trouvée. Rien à faire.");
            return;
        }

        const sourceQuery = {
            "variations.variation": { $in: unilateralVariationIds },
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
        console.log(`Sets source detectés: ${sourceCount}`);
        console.log(`Mode: ${APPLY ? "APPLY" : "DRY_RUN"}`);

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
                    console.log(`... ${processed} sources traités, ${inserted} duplicats ${APPLY ? "insérés" : "prévus"}, ${deletedSources} sources ${APPLY ? "supprimés" : "à supprimer"}`);
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

        console.log("=== Résumé backfillDuplicateUnilateralSets ===");
        console.log(`Sources traités: ${processed}`);
        console.log(`Duplicats ${APPLY ? "insérés" : "prévus"}: ${inserted}`);
        console.log(`Sources ${APPLY ? "supprimés" : "à supprimer"}: ${deletedSources}`);

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
            console.log(`Sets normalisés isUnilateral=false: ${normalizeRes.modifiedCount || 0}`);
        } else {
            console.log(`Sets à normaliser isUnilateral=false: ${toNormalize}`);
        }

        if (!APPLY) {
            console.log("Aucune écriture effectuée (dry-run). Pour appliquer: APPLY=1 node oneShotQueries/backfillDuplicateUnilateralSets.js");
        }
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

backfillDuplicateUnilateralSets();

