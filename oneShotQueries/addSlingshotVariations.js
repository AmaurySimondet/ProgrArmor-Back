/**
 * Usage:
 *   node oneShotQueries/addSlingshotVariations.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");
const { normalizeString } = require("../utils/string");

const CHAINES_ID = "669c3609218324e0b7682ad3";
const DIPS_ID = "669ced7e665a3ffe7771437b";
const BENCH_PRESS_ID = "669ced7e665a3ffe77714367";

const DIPS_SLINGSHOT_PICTURE = "https://d28n1fykqesg8f.cloudfront.net/variations/dips-slingshot.png";
const BENCH_SLINGSHOT_PICTURE = "https://d28n1fykqesg8f.cloudfront.net/variations/bench-slingshot.png";

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;

    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }

    return mongoUrl + database;
}

function reducePopularity(popularity, factor = 0.7) {
    if (typeof popularity === "number") {
        return Math.max(0, Math.round(popularity * factor));
    }

    if (Array.isArray(popularity)) {
        return popularity.map((value) => reducePopularity(value, factor));
    }

    if (popularity && typeof popularity === "object") {
        const reduced = {};
        for (const [key, value] of Object.entries(popularity)) {
            reduced[key] = reducePopularity(value, factor);
        }
        return reduced;
    }

    return popularity;
}

function cloneVariationBase(source) {
    return {
        type: source.type,
        selfmade: source.selfmade,
        megatype: source.megatype,
        isExercice: source.isExercice,
        isUnilateral: source.isUnilateral,
        muscles: source.muscles,
        weightType: source.weightType,
        includeBodyweight: source.includeBodyweight,
        exerciseBodyWeightRatio: source.exerciseBodyWeightRatio,
        mergedNamesEmbedding: source.mergedNamesEmbedding,
        mergedNames: source.mergedNames,
        picture: source.picture,
        popularity: source.popularity,
        equivalentTo: source.equivalentTo,
        verified: source.verified,
        possibleProgression: source.possibleProgression,
    };
}

function withNames(base, fr, en) {
    return {
        ...base,
        name: { fr, en },
        normalizedName: {
            fr: normalizeString(fr),
            en: normalizeString(en),
        },
    };
}

async function createIfMissingByNormalizedName(payload) {
    const existing = await Variation.findOne({
        "normalizedName.fr": payload.normalizedName.fr,
        "normalizedName.en": payload.normalizedName.en,
    }).lean();

    if (existing) {
        return { variation: existing, created: false };
    }

    const created = await Variation.create(payload);
    return { variation: created.toObject(), created: true };
}

async function run() {
    await mongoose.connect(getMongoUri(), {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    const [chaines, dips, bench] = await Promise.all([
        Variation.findById(CHAINES_ID).lean(),
        Variation.findById(DIPS_ID).lean(),
        Variation.findById(BENCH_PRESS_ID).lean(),
    ]);

    if (!chaines || !dips || !bench) {
        throw new Error("One or more source variations were not found.");
    }

    const slingshotPayload = withNames(
        cloneVariationBase(chaines),
        "Slingshot",
        "Slingshot"
    );

    const slingshotResult = await createIfMissingByNormalizedName(slingshotPayload);
    const slingshotId = slingshotResult.variation._id;

    const dipsSlingshotPayload = withNames(
        {
            ...cloneVariationBase(dips),
            picture: DIPS_SLINGSHOT_PICTURE,
            popularity: reducePopularity(dips.popularity),
            equivalentTo: [
                new mongoose.Types.ObjectId(DIPS_ID),
                new mongoose.Types.ObjectId(slingshotId),
            ],
        },
        "Dips Slingshot",
        "Slingshot Dips"
    );

    const benchSlingshotPayload = withNames(
        {
            ...cloneVariationBase(bench),
            picture: BENCH_SLINGSHOT_PICTURE,
            popularity: reducePopularity(bench.popularity),
            equivalentTo: [
                new mongoose.Types.ObjectId(BENCH_PRESS_ID),
                new mongoose.Types.ObjectId(slingshotId),
            ],
        },
        "Développé Couché Slingshot",
        "Slingshot Bench Press"
    );

    const [dipsResult, benchResult] = await Promise.all([
        createIfMissingByNormalizedName(dipsSlingshotPayload),
        createIfMissingByNormalizedName(benchSlingshotPayload),
    ]);

    console.log("Script terminé.");
    console.log(`Slingshot: ${slingshotResult.created ? "créé" : "déjà existant"} (${slingshotId})`);
    console.log(`Dips Slingshot: ${dipsResult.created ? "créé" : "déjà existant"} (${dipsResult.variation._id})`);
    console.log(`Développé Couché Slingshot: ${benchResult.created ? "créé" : "déjà existant"} (${benchResult.variation._id})`);
}

run()
    .catch((err) => {
        console.error("addSlingshotVariations failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
