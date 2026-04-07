/**
 * Supprime les UserSuccess liés aux Success de type streak_weeks.
 *
 * Usage:
 *   node oneShotQueries/deleteUserSuccessForStreakWeeks.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Success = require("../schema/success");
const UserSuccess = require("../schema/usersuccess");

async function run() {
    const mongoURL = process.env.mongoURL;
    const DATABASE = process.env.DATABASE;
    if (!mongoURL || !DATABASE) {
        throw new Error("mongoURL / DATABASE env variables are required");
    }

    await mongoose.connect(mongoURL + DATABASE);
    try {
        const streakSuccesses = await Success.find(
            { "condition.condition_code": "streak_weeks" },
            { _id: 1, level: 1, type: 1, condition: 1 }
        ).lean();

        const streakSuccessIds = streakSuccesses.map((s) => s._id);
        console.log("[deleteUserSuccessForStreakWeeks] Streak successes found:", {
            count: streakSuccessIds.length,
            ids: streakSuccessIds.map((id) => id.toString()),
        });

        if (streakSuccessIds.length === 0) {
            console.log("[deleteUserSuccessForStreakWeeks] Nothing to delete.");
            return;
        }

        const deleteRes = await UserSuccess.deleteMany({
            success: { $in: streakSuccessIds },
        });

        console.log("[deleteUserSuccessForStreakWeeks] UserSuccess deleted:", {
            deletedCount: deleteRes.deletedCount || 0,
        });
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error("[deleteUserSuccessForStreakWeeks]", err);
    process.exit(1);
});
