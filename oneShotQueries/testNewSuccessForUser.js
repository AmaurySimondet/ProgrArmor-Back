const mongoose = require("mongoose");
require("dotenv").config();

const successLib = require("../lib/success");
const UserSuccess = require("../schema/usersuccess");

const mongoURL = process.env.mongoURL;
const DATABASE = process.env.DATABASE;

async function run() {
    const userId = process.argv[2] || "6365489f44d4b4000470882b";
    const ttlMinutes = Number(process.argv[3] || 5);

    if (!mongoURL || !DATABASE) {
        throw new Error("Missing mongoURL or DATABASE in env");
    }

    await mongoose.connect(mongoURL + DATABASE);
    try {
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const beforeUnack = await UserSuccess.countDocuments({
            user: userObjectId,
            acknowledged: false,
        });

        const result = await successLib.processNewSuccesses(userId, ttlMinutes);

        const afterUnack = await UserSuccess.countDocuments({
            user: userObjectId,
            acknowledged: false,
        });

        console.log(
            JSON.stringify(
                {
                    userId,
                    ttlMinutes,
                    recalculated: result.recalculated,
                    returnedUnacknowledged: result.userSuccesses.length,
                    beforeUnacknowledged: beforeUnack,
                    afterUnacknowledged: afterUnack,
                    preview: result.userSuccesses.slice(0, 10).map((us) => ({
                        userSuccessId: String(us._id),
                        acknowledged: us.acknowledged,
                        usedOnProfile: us.usedOnProfile,
                        successType: us.success?.type,
                        successLevel: us.success?.level,
                        successNameFr: us.success?.name?.fr,
                    })),
                },
                null,
                2
            )
        );
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((error) => {
    console.error("[testNewSuccessForUser] error", error);
    process.exit(1);
});
