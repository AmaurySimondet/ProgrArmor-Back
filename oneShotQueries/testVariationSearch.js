const mongoose = require("mongoose");
const { MongoClient } = require('mongodb');
require("dotenv").config();
const variation = require("../lib/variation");
const Variation = require("../schema/variation");

mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const uri = process.env.mongoURL;
const client = new MongoClient(uri);

async function testVariationSearch(params = {}) {
    const {
        search = "bench press",
        type = undefined,
        sortBy = "name",
        page = 1,
        limit = 7,
        verified = undefined,
        isExercice = undefined,
        myExercices = undefined,
        userId = undefined,
    } = params;

    try {
        await client.connect();
        console.log("Connected to database");

        console.log("\n--- Params ---");
        console.log("search:", search);
        console.log("type:", type);
        console.log("sortBy:", sortBy);
        console.log("page:", page, "limit:", limit);
        console.log("verified:", verified, "isExercice:", isExercice);
        console.log("myExercices:", myExercices, "userId:", userId);
        console.log("--------------\n");

        const { variations, total } = await variation.getVariationBySearch(
            search, type, sortBy, page, limit, verified, isExercice, myExercices, userId
        );

        console.log("Total:", total);
        console.log("Nombre de résultats:", variations.length);
        console.log("Pagination: hasMore =", total > page * limit);

        if (variations.length > 0) {
            console.log("\nPremier résultat:", JSON.stringify(variations[0], null, 2));
        }

        variations.forEach((v, i) => {
            console.log(`  [${i}] ${v.name?.fr || v.name?.en || v._id} (score: ${v.score ?? "N/A"})`);
        });

    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        await client.close();
        await mongoose.connection.close();
        console.log('\n✅ Connexions fermées');
    }
}

async function debugVariationSearch(search = "curl") {
    try {
        await client.connect();
        console.log("Connected to database\n");

        // 1) Vérifier combien de docs existent en base
        const totalDocs = await Variation.countDocuments({});
        console.log("1) Total variations en base:", totalDocs);

        // 2) Combien ont verified=true ?
        const verifiedCount = await Variation.countDocuments({ verified: true });
        console.log("2) Variations verified=true:", verifiedCount);

        // 3) Combien ont isExercice=true ?
        const isExerciceCount = await Variation.countDocuments({ isExercice: true });
        console.log("3) Variations isExercice=true:", isExerciceCount);

        // 4) Combien ont les deux ?
        const bothCount = await Variation.countDocuments({ verified: true, isExercice: true });
        console.log("4) Variations verified=true ET isExercice=true:", bothCount);

        // 5) Combien matchent "curl" en regex (sans Atlas Search) ?
        const regexCount = await Variation.countDocuments({
            $or: [
                { "name.fr": { $regex: search, $options: "i" } },
                { "name.en": { $regex: search, $options: "i" } }
            ]
        });
        console.log(`5) Variations matchant "${search}" (regex):", ${regexCount}`);

        // 6) Combien matchent "curl" + verified + isExercice (regex) ?
        const regexFilteredCount = await Variation.countDocuments({
            $or: [
                { "name.fr": { $regex: search, $options: "i" } },
                { "name.en": { $regex: search, $options: "i" } }
            ],
            verified: true,
            isExercice: true
        });
        console.log(`6) Variations matchant "${search}" + verified + isExercice (regex):`, regexFilteredCount);

        // 7) Quelques exemples
        const samples = await Variation.find({
            $or: [
                { "name.fr": { $regex: search, $options: "i" } },
                { "name.en": { $regex: search, $options: "i" } }
            ]
        }).select("name verified isExercice").limit(5).lean();
        console.log(`\n7) Exemples de variations "${search}":`);
        samples.forEach((v, i) => {
            console.log(`  [${i}] ${v.name.fr} / ${v.name.en} | verified=${v.verified} isExercice=${v.isExercice}`);
        });

        // 8) Test Atlas Search SANS filtres
        console.log(`\n8) Atlas Search "${search}" SANS filtres:`);
        const { variations: noFilter, total: noFilterTotal } = await variation.getVariationBySearch(
            search, undefined, "name", 1, 5, undefined, undefined, undefined, undefined
        );
        console.log(`   Résultats: ${noFilter.length}, Total: ${noFilterTotal}`);
        noFilter.forEach((v, i) => {
            console.log(`   [${i}] ${v.name?.fr} / ${v.name?.en} | verified=${v.verified} isExercice=${v.isExercice}`);
        });

        // 9) Test Atlas Search avec verified=true seulement
        console.log(`\n9) Atlas Search "${search}" + verified=true:`);
        const { variations: vOnly, total: vOnlyTotal } = await variation.getVariationBySearch(
            search, undefined, "name", 1, 5, true, undefined, undefined, undefined
        );
        console.log(`   Résultats: ${vOnly.length}, Total: ${vOnlyTotal}`);

        // 10) Test Atlas Search avec isExercice=true seulement
        console.log(`\n10) Atlas Search "${search}" + isExercice=true:`);
        const { variations: eOnly, total: eOnlyTotal } = await variation.getVariationBySearch(
            search, undefined, "name", 1, 5, undefined, true, undefined, undefined
        );
        console.log(`   Résultats: ${eOnly.length}, Total: ${eOnlyTotal}`);

        // 11) Test Atlas Search avec les deux filtres
        console.log(`\n11) Atlas Search "${search}" + verified=true + isExercice=true:`);
        const { variations: both, total: bothTotal } = await variation.getVariationBySearch(
            search, undefined, "name", 1, 5, true, true, undefined, undefined
        );
        console.log(`   Résultats: ${both.length}, Total: ${bothTotal}`);

    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        await client.close();
        await mongoose.connection.close();
        console.log('\n✅ Connexions fermées');
    }
}

// --- Lancer le debug ---
debugVariationSearch("curl");
