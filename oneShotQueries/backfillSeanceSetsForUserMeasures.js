/**
 * Re-backfill SeanceSet (charges / 1RM bodyweight) à partir de la timeline UserMeasure.
 *
 * Usage:
 *   node oneShotQueries/backfillSeanceSetsForUserMeasures.js --userId=<objectId>
 *   node oneShotQueries/backfillSeanceSetsForUserMeasures.js --userId=<objectId> --full
 *   node oneShotQueries/backfillSeanceSetsForUserMeasures.js --all
 *   node oneShotQueries/backfillSeanceSetsForUserMeasures.js --userId=<objectId> --from=2026-05-01 --to=2026-06-01
 */
const mongoose = require("mongoose");
require("dotenv").config();

const UserMeasure = require("../schema/userMeasure");
const { backfillSeanceSetsForUser } = require("../lib/seanceSetBackfill");

function parseArgs(argv) {
    const out = {
        userId: null,
        all: false,
        full: true,
        from: null,
        to: null,
    };
    for (const arg of argv.slice(2)) {
        if (arg === "--all") out.all = true;
        else if (arg === "--full") out.full = true;
        else if (arg.startsWith("--userId=")) out.userId = arg.slice("--userId=".length);
        else if (arg.startsWith("--from=")) out.from = new Date(arg.slice("--from=".length));
        else if (arg.startsWith("--to=")) out.to = new Date(arg.slice("--to=".length));
        else if (arg === "--scoped") out.full = false;
    }
    if (out.from || out.to) out.full = false;
    return out;
}

async function runForUser(userId, options) {
    const started = Date.now();
    const result = await backfillSeanceSetsForUser(userId, options);
    const elapsedMs = Date.now() - started;
    console.log(
        `[backfill] user=${userId} scanned=${result.scannedCount} updated=${result.updatedCount} ${elapsedMs}ms`
    );
    return result;
}

async function run() {
    const args = parseArgs(process.argv);
    if (!args.all && !args.userId) {
        console.error("Provide --userId=<id> or --all");
        process.exit(1);
    }

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    const backfillOptions = args.full
        ? { fullRefresh: true }
        : {
            fullRefresh: false,
            ...(args.from ? { dateFrom: args.from } : {}),
            ...(args.to ? { dateTo: args.to } : {}),
        };

    let userIds = [];
    if (args.all) {
        const rows = await UserMeasure.distinct("userId");
        userIds = rows.map(String);
        console.log(`Users with measures: ${userIds.length}`);
    } else {
        userIds = [args.userId];
    }

    let totalScanned = 0;
    let totalUpdated = 0;
    const errors = [];

    for (const userId of userIds) {
        try {
            const r = await runForUser(userId, backfillOptions);
            totalScanned += r.scannedCount;
            totalUpdated += r.updatedCount;
        } catch (err) {
            errors.push({ userId, message: err.message });
            console.error(`[backfill] user=${userId} error:`, err);
        }
    }

    console.log("--- Summary ---");
    console.log(`Users processed: ${userIds.length}`);
    console.log(`Sets scanned: ${totalScanned}`);
    console.log(`Sets updated: ${totalUpdated}`);
    if (errors.length) {
        console.log(`Errors: ${errors.length}`);
        errors.forEach((e) => console.log(`  ${e.userId}: ${e.message}`));
    }

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
