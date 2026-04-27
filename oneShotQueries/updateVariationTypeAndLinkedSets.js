/**
 * One-shot: met à jour le type d'une liste de variations,
 * puis aligne leur megatype avec celui du type cible.
 * Met aussi à jour les slots liés dans SeanceSet.variations[].type.
 *
 * Usage:
 * - Dry-run:
 *   VARIATION_IDS="id1,id2,id3" TARGET_TYPE_ID="typeId" node oneShotQueries/updateVariationTypeAndLinkedSets.js
 * - Apply:
 *   APPLY=1 VARIATION_IDS="id1,id2,id3" TARGET_TYPE_ID="typeId" node oneShotQueries/updateVariationTypeAndLinkedSets.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");
const Type = require("../schema/type");
const SeanceSet = require("../schema/seanceset");

const APPLY = process.env.APPLY === "1";

function parseObjectIdList(value) {
    return (value || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((id, index, arr) => arr.indexOf(id) === index);
}

function ensureObjectId(value, label) {
    if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`${label} invalide: ${value}`);
    }
    return new mongoose.Types.ObjectId(value);
}

async function countSlotsToUpdate(variationIds, targetTypeId) {
    const result = await SeanceSet.aggregate([
        { $match: { "variations.variation": { $in: variationIds } } },
        { $unwind: "$variations" },
        {
            $match: {
                "variations.variation": { $in: variationIds },
                "variations.type": { $ne: targetTypeId }
            }
        },
        { $count: "total" }
    ]);
    return Number(result?.[0]?.total || 0);
}

async function run() {
    const variationIdStrings = parseObjectIdList(process.env.VARIATION_IDS);
    const targetTypeIdRaw = (process.env.TARGET_TYPE_ID || "").trim();

    if (!variationIdStrings.length) {
        throw new Error("VARIATION_IDS est requis (liste d'ObjectId séparés par des virgules).");
    }
    if (!targetTypeIdRaw) {
        throw new Error("TARGET_TYPE_ID est requis.");
    }

    const variationIds = variationIdStrings.map((id) => ensureObjectId(id, "Variation ID"));
    const targetTypeId = ensureObjectId(targetTypeIdRaw, "TARGET_TYPE_ID");

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    try {
        const targetType = await Type.findById(targetTypeId, { _id: 1, megatype: 1, name: 1 }).lean();
        if (!targetType) {
            throw new Error(`Type cible introuvable: ${targetTypeId}`);
        }

        const targetMegatypeId = targetType.megatype ? new mongoose.Types.ObjectId(targetType.megatype) : null;

        const existingVariationsCount = await Variation.countDocuments({ _id: { $in: variationIds } });

        const typeChangeFilter = {
            _id: { $in: variationIds },
            type: { $ne: targetTypeId }
        };

        const megatypeNeedsUpdateFilter = targetMegatypeId
            ? {
                _id: { $in: variationIds },
                $or: [
                    { megatype: { $exists: false } },
                    { megatype: null },
                    { megatype: { $ne: targetMegatypeId } }
                ]
            }
            : {
                _id: { $in: variationIds },
                megatype: { $exists: true, $ne: null }
            };

        const [typeToUpdateCount, megatypeToUpdateCount, setDocsToUpdateCount, setSlotsToUpdateCount] = await Promise.all([
            Variation.countDocuments(typeChangeFilter),
            Variation.countDocuments(megatypeNeedsUpdateFilter),
            SeanceSet.countDocuments({
                variations: {
                    $elemMatch: {
                        variation: { $in: variationIds },
                        type: { $ne: targetTypeId }
                    }
                }
            }),
            countSlotsToUpdate(variationIds, targetTypeId)
        ]);

        console.log("=== Pré-check updateVariationTypeAndLinkedSets ===");
        console.log(`Mode: ${APPLY ? "APPLY" : "DRY_RUN"}`);
        console.log(`Variations demandées: ${variationIds.length}`);
        console.log(`Variations trouvées: ${existingVariationsCount}`);
        console.log(`Variations manquantes: ${Math.max(0, variationIds.length - existingVariationsCount)} (ids inexistants)`);
        console.log(`Type cible: ${targetTypeId} (${targetType?.name?.fr || "sans nom"})`);
        console.log(`Megatype cible: ${targetMegatypeId || "null"}`);
        console.log(`Variations avec type à corriger: ${typeToUpdateCount}`);
        console.log(`Variations avec megatype à corriger: ${megatypeToUpdateCount}`);
        console.log(`SeanceSet à corriger (documents): ${setDocsToUpdateCount}`);
        console.log(`SeanceSet à corriger (slots variations): ${setSlotsToUpdateCount}`);

        if (!APPLY) {
            console.log("Dry-run terminé. Pour appliquer: APPLY=1 ...");
            return;
        }

        const variationUpdatePayload = {
            type: targetTypeId,
            megatype: targetMegatypeId
        };

        const variationUpdateResult = await Variation.updateMany(
            { _id: { $in: variationIds } },
            { $set: variationUpdatePayload }
        );

        const setsUpdateResult = await SeanceSet.updateMany(
            { "variations.variation": { $in: variationIds } },
            { $set: { "variations.$[slot].type": targetTypeId } },
            {
                arrayFilters: [
                    {
                        "slot.variation": { $in: variationIds },
                        "slot.type": { $ne: targetTypeId }
                    }
                ]
            }
        );

        console.log("=== Résultat APPLY ===");
        console.log(`Variations matched: ${variationUpdateResult.matchedCount || 0}`);
        console.log(`Variations modifiées: ${variationUpdateResult.modifiedCount || 0}`);
        console.log(`SeanceSet matched: ${setsUpdateResult.matchedCount || 0}`);
        console.log(`SeanceSet modifiés: ${setsUpdateResult.modifiedCount || 0}`);
    } finally {
        await mongoose.connection.close();
    }
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
