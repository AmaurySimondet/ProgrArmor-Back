/**
 * Backfill defaultMode on all variations.
 *
 * Usage:
 *   node oneShotQueries/backfillVariationDefaultMode.js          # dry-run
 *   node oneShotQueries/backfillVariationDefaultMode.js --apply  # apply
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');
const { schema: {
    STREET_FIGURE_TYPE_ID,
    CARDIO_TYPE_ID,
    CARDIO_REP_EXCLUSION_VARIATION_IDS,
    DEFAULT_MODES,
} } = require('../constants');

const BATCH_SIZE = 500;
const APPLY = process.argv.includes('--apply');

const exclusionSet = new Set(CARDIO_REP_EXCLUSION_VARIATION_IDS.map(String));

function resolveDefaultMode(variation) {
    const typeId = String(variation.type);
    if (typeId === STREET_FIGURE_TYPE_ID) {
        return 'seconds';
    }
    if (typeId === CARDIO_TYPE_ID) {
        if (exclusionSet.has(String(variation._id))) {
            return 'repetitions';
        }
        return 'cardio';
    }
    return 'repetitions';
}

async function backfillVariationDefaultMode() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    console.log('Connected to database:', process.env.DATABASE);
    console.log('Mode:', APPLY ? 'APPLY' : 'dry-run');
    console.log('DEFAULT_MODES:', DEFAULT_MODES.join(', '));

    const counts = { repetitions: 0, seconds: 0, cardio: 0, skipped: 0 };
    let batch = [];
    let processed = 0;

    const cursor = Variation.find({}).select('_id type defaultMode').lean().cursor();

    for await (const doc of cursor) {
        const nextMode = resolveDefaultMode(doc);
        counts[nextMode] += 1;

        if (doc.defaultMode === nextMode) {
            counts.skipped += 1;
            continue;
        }

        batch.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { defaultMode: nextMode } },
            },
        });
        processed += 1;

        if (batch.length >= BATCH_SIZE) {
            if (APPLY) {
                await Variation.bulkWrite(batch, { ordered: false });
            }
            console.log(`Processed ${processed} updates...`);
            batch = [];
        }
    }

    if (batch.length > 0 && APPLY) {
        await Variation.bulkWrite(batch, { ordered: false });
    }

    console.log('Counts by target mode:', counts);
    console.log(`Would update / updated: ${processed} variations`);
    await mongoose.disconnect();
}

backfillVariationDefaultMode().catch((err) => {
    console.error(err);
    process.exit(1);
});
