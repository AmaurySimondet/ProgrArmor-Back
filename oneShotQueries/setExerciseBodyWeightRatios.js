/**
 * Usage: node oneShotQueries/setExerciseBodyWeightRatios.js
 */
const mongoose = require("mongoose");
require("dotenv").config();
const Variation = require("../schema/variation");

function getRatioForVariationName(fr = "", en = "") {
    const n = `${fr} ${en}`.toLowerCase();
    if (/handstand push|pompes en équilibre/.test(n)) return 0.9;
    if (/^planche$|\bplank\b|planche latérale|side plank/.test(n)) return 0.45;
    if (/planche lean/.test(n)) return 0.65;
    if (/pompes sur les genoux|knee push/.test(n)) return 0.5;
    if (/australian|body rows|invers|inverted|horizont/.test(n)) return 0.7;
    if (/bench dips|sur banc/.test(n)) return 0.6;
    if (/push[- ]?up|pompe|sphinx|hindu/.test(n)) return 0.64;
    if (/dip/.test(n)) return 0.9;
    if (/pull[- ]?up|traction|chin up|muscle-up|muscle up|commando|archer|typewriter|clap/.test(n)) return 0.95;
    if (/front lever|back lever/.test(n)) return 0.9;
    if (/human flag|drapeau/.test(n)) return 0.8;
    if (/l-?sit|v-?sit|support hold/.test(n)) return 0.75;
    if (/ab wheel|rollout|russian twist|bicycle crunch|crunch|ciseaux|windshield|wipers/.test(n)) return 0.5;
    if (/wrestler.*bridge|pont du lutteur/.test(n)) return 0.6;
    return 0.85;
}

async function run() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    try {
        const rows = await Variation.find({ isExercice: true, includeBodyweight: true }, { _id: 1, name: 1 }).lean();
        const ops = rows.map((v) => ({
            updateOne: {
                filter: { _id: v._id },
                update: { $set: { exerciseBodyWeightRatio: getRatioForVariationName(v?.name?.fr, v?.name?.en) } },
            },
        }));
        if (ops.length) await Variation.bulkWrite(ops, { ordered: false });
        console.log(`Ratios appliques: ${ops.length}`);
    } finally {
        await mongoose.connection.close();
    }
}

run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
