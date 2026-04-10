const mongoose = require("mongoose");
require("dotenv").config();

const variationLib = require("../lib/variation");
const Variation = require("../schema/variation");
const { normalizeString } = require("../utils/string");

const FLOWS = [
    { label: "Tractions", fallbackWeightType: "bodyweight_plus_external", aliases: ["tractions", "traction", "pull up"] },
    { label: "Dips", fallbackWeightType: "bodyweight_plus_external", aliases: ["dips", "dip"] },
    { label: "Développé Couché", fallbackWeightType: "external_free", aliases: ["developpe couche", "bench press"] },
    { label: "Squat", fallbackWeightType: "external_free", aliases: ["squat"] },
    { label: "Soulevé de terre", fallbackWeightType: "external_free", aliases: ["souleve de terre", "deadlift"] },
    { label: "Pompes", fallbackWeightType: "bodyweight_plus_external", aliases: ["pompes", "pompe", "push up"] },
    { label: "Tirage Vertical", fallbackWeightType: "external_machine", aliases: ["tirage vertical", "lat pulldown"] },
    { label: "Leg Extension", fallbackWeightType: "external_machine", aliases: ["leg extension", "extension de jambes"] }
];

function getContextPopularity(detail, weightType) {
    if (typeof detail?.popularity === "number") return detail.popularity;
    if (!detail?.popularity || typeof detail.popularity !== "object") return 0;
    return Number(detail.popularity[weightType] ?? detail.popularity.global ?? 0);
}

async function resolvePrimaryExercise(flow) {
    const aliasList = (flow.aliases || [flow.label]).map(normalizeString);

    // 0) Direct exact alias match on normalized FR name
    const exact = await Variation.find(
        {
            isExercice: true,
            "normalizedName.fr": { $in: aliasList }
        },
        { name: 1, normalizedName: 1, weightType: 1, popularity: 1 }
    )
        .sort({ popularity: -1 })
        .limit(1)
        .lean();
    if (exact.length > 0) return exact[0];

    // 1) Try with existing search API logic (same behavior as app search)
    const normalized = aliasList[0];
    const searchResult = await variationLib.getVariationBySearch(
        normalized,
        undefined,
        "popularity",
        1,
        8,
        undefined,
        true,
        false,
        null,
        null
    );

    const firstFromSearch = (searchResult.variations || []).find(v => v?.weightType);
    if (firstFromSearch) {
        return firstFromSearch;
    }

    // 2) Fallback to direct DB query on normalizedName
    return Variation.findOne(
        {
            isExercice: true,
            "normalizedName.fr": { $regex: normalized, $options: "i" }
        },
        { name: 1, normalizedName: 1, weightType: 1, popularity: 1 }
    )
        .sort({ popularity: -1 })
        .lean();
}

async function simulateFlow(flow) {
    const primary = await resolvePrimaryExercise(flow);
    const pickedWeightType = primary?.weightType || flow.fallbackWeightType;

    const startedAt = process.hrtime.bigint();
    const { variations } = await variationLib.getAllVariations(
        undefined,
        "popularity",
        null,
        1,
        10,
        undefined,
        false,
        false,
        pickedWeightType
    );
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    return {
        exercise: flow.label,
        primary: primary
            ? {
                id: String(primary._id),
                nameFr: primary?.name?.fr,
                weightType: primary.weightType || null
            }
            : null,
        usedWeightType: pickedWeightType,
        endpointSimulation: `/user/variation/all?page=1&limit=10&isExercice=false&sortBy=popularity&weightType=${pickedWeightType}`,
        elapsedMs: Number(elapsedMs.toFixed(2)),
        top10: (variations || []).slice(0, 10).map((v, index) => ({
            rank: index + 1,
            id: String(v._id),
            nameFr: v?.name?.fr || "",
            popularityContext: getContextPopularity(v, pickedWeightType),
            popularityGlobal: typeof v?.popularity === "object" ? Number(v?.popularity?.global ?? 0) : Number(v?.popularity ?? 0),
            typeNameFr: v?.typeInfo?.name?.fr || ""
        }))
    };
}

function printAdjustmentHints(results) {
    console.log("\n=== Ajustements proposes (heuristiques) ===");

    for (const result of results) {
        const machineHeavy = result.top10.filter(v => /machine|poulie|marque de machine/i.test(v.typeNameFr)).length;
        const bodyweightHeavy = result.top10.filter(v => /positionnement des mains|positionnement des pieds|street workout|unilateral/i.test(v.typeNameFr)).length;

        let hint = "RAS";
        if (result.usedWeightType === "external_free" && machineHeavy >= 4) {
            hint = "Baisser un peu les scores machine (external_free), surtout Type de barre/poids orientes machine.";
        } else if (result.usedWeightType === "external_machine" && bodyweightHeavy >= 4) {
            hint = "Monter machine/poulie et baisser details purement poids du corps pour external_machine.";
        } else if (result.usedWeightType === "bodyweight_plus_external" && machineHeavy >= 3) {
            hint = "Baisser external_machine sur details techniques bodyweight (mains/pieds/tempo/unilateral).";
        }

        console.log(`- ${result.exercise} [${result.usedWeightType}] -> ${hint}`);
    }
}

async function run() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);

    try {
        const results = [];
        for (const flow of FLOWS) {
            const result = await simulateFlow(flow);
            results.push(result);

            console.log(`\n=== ${flow.label} ===`);
            if (result.primary) {
                console.log(`1) Exercice principal detecte: "${result.primary.nameFr}" (weightType=${result.primary.weightType || "null"})`);
            } else {
                console.log("1) Exercice principal non detecte, fallback direct sur weightType configure.");
            }
            console.log(`2) GET ${result.endpointSimulation}: ${result.elapsedMs}ms`);
            console.log("3) Top 10 variations secondaires:");
            for (const row of result.top10) {
                console.log(
                    `${String(row.rank).padStart(2, "0")}. ${row.nameFr} | popCtx=${row.popularityContext} | global=${row.popularityGlobal} | type="${row.typeNameFr}"`
                );
            }
        }

        printAdjustmentHints(results);
    } finally {
        await mongoose.connection.close();
    }
}

run().catch((err) => {
    console.error("Erreur simulateSecondaryVariationFlow:", err);
    process.exitCode = 1;
});
