const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const Variation = require("../schema/variation");

const mongoURL = process.env.mongoURL;
const DATABASE = process.env.DATABASE;

const VARIATIONS_PATH = path.join(__dirname, "..", "data", "progarmor.variations.json");

async function run() {
  if (!mongoURL) {
    console.error("mongoURL environment variable is missing");
    process.exit(1);
  }

  await mongoose.connect(mongoURL + DATABASE);
  console.log("Connected to MongoDB");

  const raw = fs.readFileSync(VARIATIONS_PATH, "utf8");
  const data = JSON.parse(raw);

  let updated = 0;
  let skipped = 0;

  for (const v of data) {
    if (!v.isExercice || !v._id || !v._id.$oid) {
      skipped++;
      continue;
    }

    const id = v._id.$oid;
    const muscles = v.muscles || { primary: [], secondary: [] };
    const weightType = v.weightType;
    const includeBodyweight = v.includeBodyweight;

    try {
      const res = await Variation.updateOne(
        { _id: id },
        {
          $set: {
            muscles: {
              primary: Array.isArray(muscles.primary) ? muscles.primary : [],
              secondary: Array.isArray(muscles.secondary) ? muscles.secondary : []
            },
            weightType,
            includeBodyweight
          }
        }
      );

      if (res.matchedCount > 0) {
        updated++;
      } else {
        skipped++;
        console.warn(`No Variation found in DB for _id=${id}`);
      }
    } catch (err) {
      skipped++;
      console.error(`Error updating variation ${id}:`, err.message);
    }
  }

  console.log(`Updated variations: ${updated}`);
  console.log(`Skipped variations: ${skipped}`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

