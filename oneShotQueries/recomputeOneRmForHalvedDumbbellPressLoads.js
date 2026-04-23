/**
 * Recalcule les champs 1RM / charges persistées pour les sets ciblés:
 * - user: 6365489f44d4b4000470882b
 * - date < 2026-04-22
 * - variations:
 *   - 669ced7e665a3ffe77714367 + 669c3609218324e0b7682aaa (DC haltères)
 *   - 669ced7e665a3ffe77714369 + 669c3609218324e0b7682aaa (DM haltères)
 *
 * Usage:
 * node oneShotQueries/recomputeOneRmForHalvedDumbbellPressLoads.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const SeanceSet = require("../schema/seanceset");
const Variation = require("../schema/variation");
const UserMeasure = require("../schema/userMeasure");
const { computeSetOneRepMaxEstimates, getEffectiveLoadKg } = require("../utils/oneRepMax");
const { KG_TO_LB, round2 } = require("../utils/seanceSetPersistedFields");

const USER_ID = "6365489f44d4b4000470882b";
const DATE_LIMIT = "2026-04-22T00:00:00.000Z";
const VARIATION_DC_HALTERES = "669ced7e665a3ffe77714367";
const VARIATION_DM_HALTERES = "669ced7e665a3ffe77714369";
const VARIATION_HALTERES = "669c3609218324e0b7682aaa";

function shouldIncludeBodyweightForVariationDocs(variationDocs) {
    const exercises = (variationDocs || []).filter((v) => v?.isExercice === true);
    return exercises.length > 0 && exercises.every((v) => v?.includeBodyweight === true);
}

function getExerciseBodyWeightRatioForVariationDocs(variationDocs) {
    const exercises = (variationDocs || []).filter((v) => v?.isExercice === true);
    const ratios = exercises
        .map((v) => Number(v?.exerciseBodyWeightRatio))
        .filter((r) => Number.isFinite(r) && r > 0);
    if (!ratios.length) return 1;
    return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

function resolveUserWeightKgForDate(userMeasures, date) {
    if (!Array.isArray(userMeasures) || !userMeasures.length) return null;
    const targetMs = new Date(date || Date.now()).getTime();
    let latest = null;
    for (const m of userMeasures) {
        const at = new Date(m?.measuredAt).getTime();
        if (!Number.isFinite(at)) continue;
        if (at <= targetMs) latest = m;
        else break;
    }
    const chosen = latest ?? userMeasures[userMeasures.length - 1];
    const kg = chosen?.weight?.kg;
    return Number.isFinite(Number(kg)) ? Number(kg) : null;
}

function variationIdsFromDoc(doc) {
    return (doc?.variations || [])
        .map((v) => (v?.variation != null ? String(v.variation) : null))
        .filter(Boolean);
}

async function run() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        const primaryVariationIds = [
            new mongoose.Types.ObjectId(VARIATION_DC_HALTERES),
            new mongoose.Types.ObjectId(VARIATION_DM_HALTERES),
        ];
        const halteresVariationId = new mongoose.Types.ObjectId(VARIATION_HALTERES);

        const filter = {
            user: new mongoose.Types.ObjectId(USER_ID),
            date: { $lt: new Date(DATE_LIMIT) },
            variations: {
                $all: [
                    { $elemMatch: { variation: { $in: primaryVariationIds } } },
                    { $elemMatch: { variation: halteresVariationId } },
                ],
            },
        };

        const docs = await SeanceSet.find(filter).lean();
        console.log(`Sets ciblés pour recalcul: ${docs.length}`);
        if (!docs.length) return;

        const varIds = [...new Set(docs.flatMap(variationIdsFromDoc))];
        const variationDocs = await Variation.find(
            { _id: { $in: varIds } },
            { isExercice: 1, includeBodyweight: 1, exerciseBodyWeightRatio: 1 }
        ).lean();
        const varById = new Map(variationDocs.map((v) => [String(v._id), v]));

        const userMeasures = await UserMeasure.find(
            { userId: USER_ID },
            { measuredAt: 1, "weight.kg": 1 }
        ).sort({ measuredAt: 1 }).lean();

        const ops = [];
        for (const doc of docs) {
            const docVarDocs = variationIdsFromDoc(doc).map((id) => varById.get(id)).filter(Boolean);
            const includeBodyweight = shouldIncludeBodyweightForVariationDocs(docVarDocs);
            const ratio = getExerciseBodyWeightRatioForVariationDocs(docVarDocs);

            const effectiveWeightLoad = round2(getEffectiveLoadKg(doc));
            const effectiveWeightLoadLbs = effectiveWeightLoad != null ? round2(effectiveWeightLoad * KG_TO_LB) : null;
            const weightLoadLbs = Number.isFinite(Number(doc.weightLoad)) ? round2(Number(doc.weightLoad) * KG_TO_LB) : null;

            let oneRepMaxIncludesBodyweight = false;
            let oneRepMaxUserWeightKg = null;
            let oneRepMaxExerciseBodyWeightRatio = null;
            let effectiveWeightLoadWithBodyweight = null;
            let effectiveWeightLoadWithBodyweightLbs = null;
            let brzyckiWithBodyweight = null;
            let epleyWithBodyweight = null;
            let { brzycki, epley } = computeSetOneRepMaxEstimates(doc);

            if (includeBodyweight) {
                const w = resolveUserWeightKgForDate(userMeasures, doc.date);
                if (Number.isFinite(Number(w)) && w > 0) {
                    const weighted = Number(w) * Number(ratio || 1);
                    oneRepMaxIncludesBodyweight = true;
                    oneRepMaxUserWeightKg = Number(w);
                    oneRepMaxExerciseBodyWeightRatio = Number(ratio || 1);
                    effectiveWeightLoadWithBodyweight = round2(
                        getEffectiveLoadKg(doc, { includeBodyweight: true, userWeightKg: weighted })
                    );
                    effectiveWeightLoadWithBodyweightLbs = effectiveWeightLoadWithBodyweight != null
                        ? round2(effectiveWeightLoadWithBodyweight * KG_TO_LB)
                        : null;

                    const withBw = computeSetOneRepMaxEstimates({
                        ...doc,
                        weightLoad: effectiveWeightLoadWithBodyweight,
                        elastic: null,
                    });
                    brzyckiWithBodyweight = withBw.brzycki;
                    epleyWithBodyweight = withBw.epley;
                    brzycki = brzyckiWithBodyweight != null ? round2(brzyckiWithBodyweight - weighted) : null;
                    epley = epleyWithBodyweight != null ? round2(epleyWithBodyweight - weighted) : null;
                } else {
                    brzycki = null;
                    epley = null;
                }
            }

            ops.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: {
                        $set: {
                            effectiveWeightLoad,
                            effectiveWeightLoadWithBodyweight,
                            weightLoadLbs,
                            effectiveWeightLoadLbs,
                            effectiveWeightLoadWithBodyweightLbs,
                            brzycki,
                            epley,
                            oneRepMaxIncludesBodyweight,
                            oneRepMaxUserWeightKg,
                            oneRepMaxExerciseBodyWeightRatio,
                            brzyckiWithBodyweight,
                            epleyWithBodyweight,
                        },
                    },
                },
            });
        }

        const result = await SeanceSet.bulkWrite(ops, { ordered: false });
        console.log(`Matched: ${result.matchedCount || 0}`);
        console.log(`Modified: ${result.modifiedCount || 0}`);
    } catch (error) {
        console.error("Erreur recomputeOneRmForHalvedDumbbellPressLoads:", error);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

run();
