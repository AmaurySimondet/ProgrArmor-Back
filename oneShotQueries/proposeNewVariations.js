const mongoose = require("mongoose");
const SeanceSet = require("../schema/seanceset");
const Variation = require("../schema/variation");
// Register referenced models for population
require("../schema/type");
require("../schema/megatype");

const { getVariationBySearch } = require("../lib/variation");
const { normalizeString } = require("../utils/string");
const fs = require("fs");
const path = require("path");
// Load .env from root
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Connect to MongoDB
const mongoURI = (process.env.mongoURL || "") + (process.env.DATABASE || "");
if (!mongoURI) {
    console.error("❌ Error: mongoURL or DATABASE env vars are missing.");
    console.log("mongoURL:", process.env.mongoURL ? "Set" : "Unset");
    console.log("DATABASE:", process.env.DATABASE ? "Set" : "Unset");
    process.exit(1);
}

mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

(async () => {
    try {
        console.log("🚀 Starting variations proposal generation...");

        // 1. Aggregate unique combinations of variations from SeanceSets
        console.log("📥 Aggregating unique variation combinations...");
        const uniqueCombinations = await SeanceSet.aggregate([
            // Only consider sets with at least 2 variations (implied by "combination")
            { $match: { "variations.1": { $exists: true } } },
            // Project just the variations array (keeping IDs only)
            {
                $project: {
                    _id: 0,
                    variations: "$variations.variation"
                }
            },
            // Group by the exact array content to find unique combinations
            {
                $group: {
                    _id: "$variations",
                    count: { $sum: 1 }
                }
            },
            // Sort by frequency
            { $sort: { count: -1 } }
        ]);

        console.log(`✅ Found ${uniqueCombinations.length} unique combinations.`);

        const proposals = [];
        let processedCount = 0;

        // 2. Process each combination
        for (const combo of uniqueCombinations) {
            const variationIds = combo._id;

            // Fetch variation details (preserving order is important for name construction)
            // mongo .find with $in does not guarantee order, so we must reorder manually
            const variationsDocs = await Variation.find({ _id: { $in: variationIds } }).populate('type').populate('megatype').lean();

            // Reorder to match the combination order
            const orderedVariations = variationIds.map(id => {
                if (!id) return null;
                return variationsDocs.find(v => v && v._id && v._id.toString() === id.toString());
            }).filter(v => v);

            if (orderedVariations.length < 2) continue;

            // Constraint: variation1 should have isExercice: true
            if (!orderedVariations[0].isExercice) {
                // console.log(`Skipping combination starting with non-exercise: ${orderedVariations[0].name.fr}`);
                continue;
            }

            // Construct names
            const nameFr = orderedVariations.map(v => v.name.fr).join(" + ");
            const nameEn = orderedVariations.map(v => v.name.en).join(" + ");

            // Construct normalized names (clean each part then join, or join then clean?)
            // User said: "normalizedNames"
            // Usually normalizedName is a single string. I'll concat normalizedNames of parts.
            // But `normalizeString` function does it for a string.
            // Let's use the concatenated name to generate normalized name to be safe and consistent.
            const normalizedNameFr = normalizeString(nameFr);
            const normalizedNameEn = normalizeString(nameEn);

            // Check for duplicates in DB (strict normalized match)
            const existingExact = await Variation.findOne({
                $or: [
                    { "normalizedName.fr": normalizedNameFr },
                    { "normalizedName.en": normalizedNameEn }
                ]
            });

            // Check for similarity using getVariationBySearch
            // We search for the French name
            const searchResult = await getVariationBySearch(nameFr, null, null, 1, 5);
            const similarVariations = searchResult.variations.map(v => ({
                id: v._id,
                name: v.name.fr,
                score: v.score // if available from atlas search
            }));

            const proposal = {
                name: {
                    fr: nameFr,
                    en: nameEn
                },
                normalizedName: {
                    fr: normalizedNameFr,
                    en: normalizedNameEn
                },
                isExercice: true,
                selfmade: false, // Assuming system generated
                madeOf: orderedVariations.map(v => ({
                    _id: v._id,
                    name: v.name,
                    type: v.type?.name,
                    megatype: v.megatype?.name
                })),
                // Inherit type/megatype from the base exercise
                type: orderedVariations[0].type,
                megatype: orderedVariations[0].megatype,

                // Meta info
                occurrenceCount: combo.count,
                existingExactMatch: existingExact ? { _id: existingExact._id, name: existingExact.name } : null,
                similarFound: similarVariations
            };

            proposals.push(proposal);

            processedCount++;
            if (processedCount % 10 === 0) {
                console.log(`Processed ${processedCount}/${uniqueCombinations.length} combinations...`);
            }
        }

        // 3. Write to JSON file
        const outputPath = "newVariationsProposal.json";
        fs.writeFileSync(outputPath, JSON.stringify(proposals, null, 2));

        console.log(`✅ Finished! Proposals written to ${outputPath}`);
        console.log(`Total proposals generated: ${proposals.length}`);

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        await mongoose.connection.close();
        console.log("🔌 MongoDB connection closed.");
    }
})();

