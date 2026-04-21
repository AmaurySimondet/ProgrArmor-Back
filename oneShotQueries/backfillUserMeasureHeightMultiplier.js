const mongoose = require("mongoose");
require("dotenv").config();

const UserMeasure = require("../schema/userMeasure");

function computeHeightMultiplier(heightCm) {
    const h = Number(heightCm);
    if (!Number.isFinite(h) || h <= 0) return 1;
    return Math.round((((h / 170) ** 2) + Number.EPSILON) * 1000000) / 1000000;
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

        const cursor = UserMeasure.find({}, { _id: 1, "height.cm": 1 }).lean().cursor();
        let scanned = 0;
        let updated = 0;

        for await (const measure of cursor) {
            scanned += 1;
            const nextValue = computeHeightMultiplier(measure?.height?.cm);
            const result = await UserMeasure.updateOne(
                { _id: measure._id },
                { $set: { heightMultiplier: nextValue } }
            );
            updated += result.modifiedCount || 0;
        }

        console.log(`Scanned: ${scanned}`);
        console.log(`Updated: ${updated}`);
    } catch (error) {
        console.error("Backfill failed:", error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
}

run();
