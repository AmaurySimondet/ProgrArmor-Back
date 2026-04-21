const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");

const DETAILS_TYPE_ID = "669cda3b33e75a33610be158";
const EXERCISES_TYPE_ID = "669cee980c89e9434327caa8";
const OUTPUT_PATH = path.join(__dirname, "data", "streetworkout-variations.csv");

function escapeCsvValue(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function toCsvLine(values) {
    return values.map(escapeCsvValue).join(",");
}

function formatPopularity(popularity) {
    if (typeof popularity === "number") return popularity;
    if (popularity && typeof popularity === "object") return JSON.stringify(popularity);
    return "";
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;

    if (!mongoUrl || !database) {
        console.error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUrl + database);
        console.log("Connected to MongoDB");

        const variations = await Variation.find(
            {
                type: { $in: [DETAILS_TYPE_ID, EXERCISES_TYPE_ID] }
            },
            {
                _id: 1,
                type: 1,
                isExercice: 1,
                verified: 1,
                popularity: 1,
                "name.fr": 1,
                "name.en": 1,
                equivalentTo: 1
            }
        ).sort({ isExercice: -1, "name.fr": 1 }).lean();

        const header = [
            "_id",
            "type",
            "typeLabel",
            "isExercice",
            "verified",
            "popularity",
            "name_fr",
            "name_en",
            "equivalentTo"
        ];

        const rows = [toCsvLine(header)];

        for (const v of variations) {
            const typeId = v.type?.toString() || "";
            const typeLabel = typeId === DETAILS_TYPE_ID ? "details" : "exercices";
            rows.push(
                toCsvLine([
                    v._id?.toString() || "",
                    typeId,
                    typeLabel,
                    v.isExercice === true ? "TRUE" : "FALSE",
                    v.verified === true ? "TRUE" : "FALSE",
                    formatPopularity(v.popularity),
                    v.name?.fr || "",
                    v.name?.en || "",
                    (v.equivalentTo || []).map((id) => id.toString()).join("|")
                ])
            );
        }

        fs.writeFileSync(OUTPUT_PATH, `${rows.join("\n")}\n`, "utf8");
        console.log(`CSV exported: ${OUTPUT_PATH}`);
        console.log(`Rows exported: ${variations.length}`);
    } catch (error) {
        console.error("Export failed:", error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
}

run();
