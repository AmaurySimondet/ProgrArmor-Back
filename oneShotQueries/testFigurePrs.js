/**
 * Usage:
 *   node oneShotQueries/testFigurePrs.js
 * Compare PRs « classiques » vs entrée isDirect des routes figure (traction + drapeau).
 */
const mongoose = require("mongoose");
require("dotenv").config();

const setLib = require("../lib/set");
const Set = require("../schema/seanceset");

const USER_ID = "6365489f44d4b4000470882b";
const VAR_TRACTION = "669ced7e665a3ffe77714379";
const VAR_DRAPEAU = "669ced7e665a3ffe77714388";

async function findExerciceIdForVariation(userId, variationId) {
    const row = await Set.findOne(
        {
            user: new mongoose.Types.ObjectId(userId),
            "variations.variation": new mongoose.Types.ObjectId(variationId)
        },
        { exercice: 1 }
    ).lean();
    return row?.exercice ? String(row.exercice) : null;
}

function summarizePrs(prs) {
    if (!prs || typeof prs !== "object") return null;
    const keys = Object.keys(prs);
    const nonNull = keys.filter((k) => {
        const v = prs[k];
        if (v && typeof v === "object" && ("repetitions" in v || "seconds" in v)) {
            return v.repetitions != null || v.seconds != null;
        }
        return v != null;
    });
    return { keys: keys.length, nonNullCategories: nonNull.length };
}

/** Compare les PR « utiles » (évite faux négatifs sur sous-docs variations / ordre clés). */
function prsFunctionallyEqual(a, b) {
    const pick = (s) => {
        if (!s || typeof s !== "object") return null;
        return {
            id: s._id != null ? String(s._id) : null,
            value: s.value,
            weightLoad: s.weightLoad,
            unit: s.unit
        };
    };
    const sig = (prs) => ({
        Puissance: { r: pick(prs.Puissance?.repetitions), s: pick(prs.Puissance?.seconds) },
        Force: { r: pick(prs.Force?.repetitions), s: pick(prs.Force?.seconds) },
        Volume: { r: pick(prs.Volume?.repetitions), s: pick(prs.Volume?.seconds) },
        Endurance: { r: pick(prs.Endurance?.repetitions), s: pick(prs.Endurance?.seconds) },
        Last: { r: pick(prs.Last?.repetitions), s: pick(prs.Last?.seconds) }
    });
    return JSON.stringify(sig(a)) === JSON.stringify(sig(b));
}

function detailedPrsFunctionallyEqual(a, b) {
    const pick = (s) => {
        if (!s || typeof s !== "object") return null;
        return {
            id: s._id != null ? String(s._id) : null,
            value: s.value,
            weightLoad: s.weightLoad,
            unit: s.unit
        };
    };
    const keys = [...new global.Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => k === "Last" || /^\d+RM$/.test(k));
    keys.sort((x, y) => {
        if (x === "Last") return 1;
        if (y === "Last") return -1;
        return Number(x.replace("RM", "")) - Number(y.replace("RM", ""));
    });
    for (const k of keys) {
        const sa = JSON.stringify({ r: pick(a[k]?.repetitions), s: pick(a[k]?.seconds) });
        const sb = JSON.stringify({ r: pick(b[k]?.repetitions), s: pick(b[k]?.seconds) });
        if (sa !== sb) return false;
    }
    return true;
}

async function runScenario(label, { userId, exercice, mainExerciseId, referenceVariationId, includeAllGraphTargets }) {
    console.log(`\n========== ${label} ==========`);
    console.log({ exercice, mainExerciseId, referenceVariationId, includeAllGraphTargets });

    const classic = await setLib.getPRs(userId, null, exercice, null, null, referenceVariationId, undefined);
    const figure = await setLib.getFigurePRs({
        userId,
        excludedSeanceId: null,
        exercice,
        categories: null,
        dateMin: null,
        unilateralSide: undefined,
        referenceVariations: referenceVariationId,
        mainExerciseId,
        includeAllGraphTargets,
        maxTargets: 40
    });

    const direct = figure.entries.find((e) => e.isDirect);
    console.log("classic PRs summary:", summarizePrs(classic));
    console.log("figure meta:", figure.meta);
    console.log("figure entries:", figure.entries.map((e) => ({
        variationId: e.variationId,
        isDirect: e.isDirect,
        name: e.name,
        summary: summarizePrs(e.prs)
    })));

    const match = direct && prsFunctionallyEqual(classic, direct.prs);
    console.log("isDirect.prs ≈ getPRs (valeurs PR / ids de séries):", match);
    if (!match && direct) {
        console.log("Échec comparaison fonctionnelle — inspecter les PR classiques vs figure.");
    }

    const detailedClassic = await setLib.getDetailedPRs(userId, exercice, null, null, referenceVariationId, undefined);
    const detailedFigure = await setLib.getFigureDetailedPRs({
        userId,
        exercice,
        categories: null,
        dateMin: null,
        unilateralSide: undefined,
        referenceVariations: referenceVariationId,
        mainExerciseId,
        includeAllGraphTargets,
        maxTargets: 40
    });
    const dDirect = detailedFigure.entries.find((e) => e.isDirect);
    const dMatch = dDirect && detailedPrsFunctionallyEqual(detailedClassic, dDirect.prs);
    console.log("detailed isDirect.prs ≈ getDetailedPRs:", dMatch);
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    const exTraction = await findExerciceIdForVariation(USER_ID, VAR_TRACTION);
    const exDrapeau = await findExerciceIdForVariation(USER_ID, VAR_DRAPEAU);

    if (!exTraction) {
        console.warn("Aucun set trouvé pour traction + user, skip traction.");
    } else {
        await runScenario("Tractions (non street, régression classique vs isDirect)", {
            userId: USER_ID,
            exercice: exTraction,
            mainExerciseId: VAR_TRACTION,
            referenceVariationId: VAR_TRACTION,
            includeAllGraphTargets: true
        });
    }

    if (!exDrapeau) {
        console.warn("Aucun set trouvé pour drapeau + user, skip drapeau.");
    } else {
        await runScenario("Drapeau + graphe", {
            userId: USER_ID,
            exercice: exDrapeau,
            mainExerciseId: VAR_DRAPEAU,
            referenceVariationId: VAR_DRAPEAU,
            includeAllGraphTargets: true
        });
    }

    console.log("\nDone.");
}

run()
    .catch((err) => {
        console.error("Test failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
