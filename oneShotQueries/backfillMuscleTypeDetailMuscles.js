/**
 * Backfill muscles.primary on variations of type Muscle (isExercice=false).
 *
 * Usage:
 *   node oneShotQueries/backfillMuscleTypeDetailMuscles.js [--dry-run]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Variation = require('../schema/variation');
const { schema: { MUSCLE_TYPE_ID } } = require('../constants');

/** variationId → primary muscle keys (enum MUSCLES) */
const MUSCLE_DETAIL_PRIMARY_BY_ID = {
    '669c3609218324e0b7682a45': ['biceps'], // Biceps
    '669c3609218324e0b7682a44': ['triceps'], // Triceps
    '669c3609218324e0b7682a43': ['forearms'], // Avant bras
    '691b3b709c28bf0f3ee1235a': ['forearms'], // Poignet
    '677e94e06294b680edf9762c': ['hamstrings'], // Ischio-jambier
    '677e94c16294b680edf9762b': ['quads'], // Quadriceps
    '677e95e46294b680edf97630': ['glutes'], // Fessiers
    '677e95416294b680edf9762d': ['calves'], // Mollets
    '677e947b6294b680edf97629': ['abs'], // Abdominaux
    '677e957e6294b680edf9762e': ['traps'], // Trapèzes
    '677e95b76294b680edf9762f': ['spinal_erectors'], // Lombaires
    '677e94356294b680edf97628': ['chest'], // Pectauraux
    '691b3d129c28bf0f3ee1235b': ['neck'], // Cou
    '669c3609218324e0b7682a46': ['lats', 'upper_back'], // Dos
    '669c3609218324e0b7682a47': ['quads', 'hamstrings', 'glutes'], // Jambe
    '669c3609218324e0b7682a49': ['deltoids_front', 'deltoids_side', 'deltoids_rear'], // Epaules
    '669c3609218324e0b7682a48': ['glutes', 'abductors'], // Hanches
    '69207017f94b17a153ce44bf': ['upper_back'], // Scapula
    // Tibia (677e9635… / 69207826…) : hors enum MUSCLES → skip
};

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    }

    await mongoose.connect(mongoUrl + database);

    const muscleTypeId = new mongoose.Types.ObjectId(MUSCLE_TYPE_ID);
    const details = await Variation.find({
        type: muscleTypeId,
        isExercice: false,
    })
        .select('name muscles')
        .lean();

    console.log(`Found ${details.length} Muscle-type details. dryRun=${dryRun}`);

    let updated = 0;
    let skipped = 0;
    let unmapped = 0;

    for (const detail of details) {
        const id = String(detail._id);
        const primary = MUSCLE_DETAIL_PRIMARY_BY_ID[id];
        if (!primary || primary.length === 0) {
            console.log(`  skip (unmapped): ${detail.name?.fr || id}`);
            unmapped += 1;
            continue;
        }

        const currentPrimary = detail.muscles?.primary || [];
        const same = currentPrimary.length === primary.length
            && primary.every((key, index) => currentPrimary[index] === key);
        if (same && Array.isArray(detail.muscles?.secondary) && detail.muscles.secondary.length === 0) {
            skipped += 1;
            continue;
        }

        console.log(`  ${dryRun ? 'would update' : 'update'}: ${detail.name?.fr} → primary=[${primary.join(', ')}]`);
        if (!dryRun) {
            await Variation.updateOne(
                { _id: detail._id },
                { $set: { muscles: { primary, secondary: [] } } },
            );
        }
        updated += 1;
    }

    console.log(`Done. updated=${updated} skipped=${skipped} unmapped=${unmapped}`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
