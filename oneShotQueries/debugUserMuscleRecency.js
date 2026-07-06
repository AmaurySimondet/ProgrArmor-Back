/**
 * Debug récence musculaire pour un utilisateur.
 * Usage: node oneShotQueries/debugUserMuscleRecency.js [userId]
 */
const mongoose = require('mongoose');
require('dotenv').config();

const SeanceSet = require('../schema/seanceset');
const Variation = require('../schema/variation');
const {
    computeUserMuscleRecency,
    computeDaysSince,
} = require('../lib/userMuscleRecency');

const USER_ID = process.argv[2] || '6365489f44d4b4000470882b';
const TARGET_MUSCLES = ['adductors', 'abductors'];

async function main() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }

    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    const userIdObj = new mongoose.Types.ObjectId(USER_ID);
    const now = new Date();

    console.log('=== User muscle recency debug ===');
    console.log('userId:', USER_ID);
    console.log('now:', now.toISOString());

    const variationLastDates = await SeanceSet.aggregate([
        { $match: { user: userIdObj } },
        { $unwind: '$variations' },
        { $group: { _id: '$variations.variation', lastDate: { $max: '$date' } } },
    ]);
    const variationIds = variationLastDates.map((e) => e._id);
    const variations = await Variation.find({ _id: { $in: variationIds } })
        .select('name muscles isExercice')
        .lean();

    const payload = await computeUserMuscleRecency(userIdObj, now);
    console.log('\n--- API result for adductors/abductors ---');
    for (const m of TARGET_MUSCLES) {
        console.log(m, payload.muscles[m] || '(absent)');
    }

    const recentSets = await SeanceSet.find({ user: userIdObj })
        .sort({ date: -1 })
        .limit(200)
        .select('date variations mergedVariationsNames')
        .lean();

    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const todayKey = now.toISOString().slice(0, 10);

    console.log('\n--- Recent sets (last 30) ---');
    for (const set of recentSets.slice(0, 30)) {
        const dateKey = new Date(set.date).toISOString().slice(0, 10);
        const names = set.mergedVariationsNames?.fr || set.mergedVariationsNames?.en || '';
        const ids = (set.variations || []).map((v) => String(v.variation));
        console.log(`${dateKey} | ${names || ids.join(' + ')}`);
    }

    console.log('\n--- Sets from yesterday/today mentioning cuisse/adduct/abduct ---');
    const thighKeywords = /cuisse|adduct|abduct|intérieur|extérieur|hip/i;
    const matchingSets = recentSets.filter((set) => {
        const dateKey = new Date(set.date).toISOString().slice(0, 10);
        if (dateKey !== yesterdayKey && dateKey !== todayKey) return false;
        const names = JSON.stringify(set.mergedVariationsNames || {});
        return thighKeywords.test(names);
    });

    const allVariationIds = new Set();
    for (const set of matchingSets) {
        const dateKey = new Date(set.date).toISOString().slice(0, 10);
        const names = set.mergedVariationsNames?.fr || '';
        const ids = (set.variations || []).map((v) => String(v.variation));
        ids.forEach((id) => allVariationIds.add(id));
        console.log(`\n${dateKey} | ${names}`);
        console.log('  variation IDs:', ids.join(', '));
    }

    if (allVariationIds.size > 0) {
        const docs = await Variation.find({ _id: { $in: [...allVariationIds] } })
            .select('name muscles isExercice')
            .lean();
        console.log('\n--- Variation muscle tags for matching sets ---');
        for (const doc of docs) {
            console.log(JSON.stringify({
                id: String(doc._id),
                name: doc.name?.fr,
                isExercice: doc.isExercice,
                muscles: doc.muscles,
            }, null, 2));
        }
    }

    console.log('\n--- All performed variations that map to adductors/abductors ---');
    const withMuscles = variations.filter((v) => {
        const p = v.muscles?.primary || [];
        const s = v.muscles?.secondary || [];
        return TARGET_MUSCLES.some((m) => p.includes(m) || s.includes(m));
    });
    for (const v of withMuscles) {
        const last = variationLastDates.find((e) => String(e._id) === String(v._id));
        const days = last ? computeDaysSince(last.lastDate, now) : null;
        console.log({
            id: String(v._id),
            name: v.name?.fr,
            muscles: v.muscles,
            lastDate: last?.lastDate?.toISOString?.(),
            daysSince: days,
        });
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
