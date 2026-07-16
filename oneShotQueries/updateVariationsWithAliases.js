/**
 * Backfill aliases for variations.
 *
 * Usage:
 *   node oneShotQueries/updateVariationsWithAliases.js          # dry-run
 *   node oneShotQueries/updateVariationsWithAliases.js --apply  # apply
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }
    return mongoUrl + database;
}

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function compactSpaces(value) {
    return String(value || '').replace(/\s+/g, '');
}

function createAliasCollector(initialAliases = []) {
    const values = [];
    const keys = new Set();

    function push(alias) {
        const clean = String(alias || '').trim();
        if (!clean) return;
        const dedupeKey = normalize(clean);
        if (!dedupeKey || keys.has(dedupeKey)) return;
        keys.add(dedupeKey);
        values.push(clean);
    }

    for (const alias of initialAliases) {
        push(alias);
    }

    return { push, values };
}

function equalsEn(doc, value) {
    return normalize(doc?.normalizedName?.en || doc?.name?.en) === normalize(value);
}

function includesEn(doc, value) {
    return normalize(doc?.normalizedName?.en || doc?.name?.en).includes(normalize(value));
}

function startsWithEn(doc, value) {
    return normalize(doc?.normalizedName?.en || doc?.name?.en).startsWith(normalize(value));
}

function endsWithEn(doc, value) {
    return normalize(doc?.normalizedName?.en || doc?.name?.en).endsWith(normalize(value));
}

const CURATED_RULES = [
    {
        when: (doc) => equalsEn(doc, 'bench press'),
        aliases: ['DC', 'Bench', 'Bench Press', 'Barbell Bench Press', 'Barbell Bench', 'Flat Bench'],
    },
    {
        when: (doc) => equalsEn(doc, 'incline bench press'),
        aliases: ['DI', 'Incline Bench', 'Incline Press', 'Incline BB Press'],
    },
    {
        when: (doc) => equalsEn(doc, 'military press'),
        aliases: ['DM', 'OHP', 'Overhead Press', 'Military Press', 'Shoulder Press', 'Strict Press'],
    },
    {
        when: (doc) => equalsEn(doc, 'squat'),
        aliases: ['Back Squat', 'High Bar Squat', 'Low Bar Squat', 'BB Squat'],
    },
    {
        when: (doc) => equalsEn(doc, 'deadlift'),
        aliases: ['SDT', 'Deadlift', 'Conventional Deadlift', 'DL'],
    },
    {
        when: (doc) => equalsEn(doc, 'romanian deadlift'),
        aliases: ['RDL', 'Romanian Deadlift', 'Romanian DL'],
    },
    {
        when: (doc) => equalsEn(doc, 'stiff leg deadlift'),
        aliases: ['SLDL', 'Stiff Leg Deadlift', 'Stiff Leg DL'],
    },
    {
        when: (doc) => equalsEn(doc, 'pull ups'),
        aliases: ['Pull-up', 'Pull Up', 'Pullup'],
    },
    {
        when: (doc) => equalsEn(doc, 'chin ups'),
        aliases: ['Chin-up', 'Chin Up', 'Chinup'],
    },
    {
        when: (doc) => equalsEn(doc, 'bent over row'),
        aliases: ['Barbell Row', 'Bent Over Row', 'BOR', 'BB Row'],
    },
    {
        when: (doc) => equalsEn(doc, 'seated cable row'),
        aliases: ['Seated Cable Row', 'Cable Row', 'Low Row'],
    },
    {
        when: (doc) => includesEn(doc, 'lat pulldown'),
        aliases: ['Lat Pulldown', 'Lat Pull Down', 'Pulldown'],
    },
    {
        when: (doc) => equalsEn(doc, 'dips'),
        aliases: ['Parallel Bar Dips', 'Chest Dips', 'Triceps Dips'],
    },
    {
        when: (doc) => equalsEn(doc, 'barbell curl'),
        aliases: ['Barbell Curl', 'BB Curl', 'Standing Curl'],
    },
    {
        when: (doc) => includesEn(doc, 'hammer curl'),
        aliases: ['Hammer Curl', 'Hammer DB Curl'],
    },
    {
        when: (doc) => includesEn(doc, 'tricep pushdown'),
        aliases: ['Pushdown', 'Triceps Pushdown', 'Cable Pushdown', 'Pressdown'],
    },
    {
        when: (doc) => endsWithEn(doc, 'lateral raise'),
        aliases: ['Lateral Raise', 'Side Raise', 'Lat Raise'],
    },
    {
        when: (doc) => includesEn(doc, 'reverse fly'),
        aliases: ['Reverse Fly', 'Rear Delt Fly', 'Bent Over Fly'],
    },
    {
        when: (doc) => includesEn(doc, 'hip thrust'),
        aliases: ['Barbell Hip Thrust', 'Glute Bridge'],
    },
    {
        when: (doc) => includesEn(doc, 'leg press') || includesEn(doc, 'presse a cuisses'),
        aliases: ['Leg Press', '45 Leg Press', 'Sled Leg Press'],
    },
    {
        when: (doc) => includesEn(doc, 'leg curl'),
        aliases: ['Hamstring Curl', 'Lying Leg Curl', 'Seated Leg Curl'],
    },
    {
        when: (doc) => includesEn(doc, 'leg extension'),
        aliases: ['Quad Extension', 'Knee Extension'],
    },
    {
        when: (doc) => includesEn(doc, 'standing calf raise'),
        aliases: ['Standing Calf Raise', 'Calf Raise'],
    },
];

function buildAliases(doc) {
    const collector = createAliasCollector(Array.isArray(doc.aliases) ? doc.aliases : []);

    const nameFr = String(doc?.name?.fr || '').trim();
    const nameEn = String(doc?.name?.en || '').trim();
    const normalizedFr = String(doc?.normalizedName?.fr || '').trim();
    const normalizedEn = String(doc?.normalizedName?.en || '').trim();

    collector.push(nameFr);
    collector.push(nameEn);
    collector.push(normalizedFr);
    collector.push(normalizedEn);

    collector.push(compactSpaces(normalizedFr));
    collector.push(compactSpaces(normalizedEn));

    if (doc?.isExercice === true) {
        for (const rule of CURATED_RULES) {
            if (rule.when(doc)) {
                for (const alias of rule.aliases) {
                    collector.push(alias);
                }
            }
        }
    }

    return collector.values;
}

function aliasesSignature(arr) {
    return (arr || [])
        .map((x) => normalize(x))
        .filter(Boolean)
        .sort()
        .join('|');
}

async function run() {
    await mongoose.connect(getMongoUri());
    console.log('Connected to database:', process.env.DATABASE);
    console.log('Mode:', APPLY ? 'APPLY' : 'dry-run');

    const cursor = Variation.find(
        {},
        { _id: 1, isExercice: 1, name: 1, normalizedName: 1, aliases: 1 }
    ).lean().cursor();

    let total = 0;
    let changed = 0;
    let unchanged = 0;
    const sampleChanges = [];
    let operations = [];

    for await (const doc of cursor) {
        total += 1;
        const previous = Array.isArray(doc.aliases) ? doc.aliases : [];
        const nextAliases = buildAliases(doc);

        if (aliasesSignature(previous) === aliasesSignature(nextAliases)) {
            unchanged += 1;
            continue;
        }

        changed += 1;
        if (sampleChanges.length < 10) {
            sampleChanges.push({
                _id: String(doc._id),
                nameFr: doc?.name?.fr || null,
                nameEn: doc?.name?.en || null,
                oldCount: previous.length,
                newCount: nextAliases.length,
                aliasesPreview: nextAliases.slice(0, 12),
            });
        }

        operations.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { aliases: nextAliases } },
            },
        });

        if (operations.length >= BATCH_SIZE) {
            if (APPLY) {
                await Variation.bulkWrite(operations, { ordered: false });
            }
            operations = [];
        }
    }

    if (operations.length > 0 && APPLY) {
        await Variation.bulkWrite(operations, { ordered: false });
    }

    console.log('\n=== Backfill aliases summary ===');
    console.log({
        applyMode: APPLY,
        total,
        changed,
        unchanged,
    });
    console.log('\nSample changed documents:', sampleChanges);

    if (!APPLY) {
        console.log('\nDry-run only. Use --apply to persist.');
    }
}

run()
    .catch(async (error) => {
        console.error('updateVariationsWithAliases failed:', error);
        process.exitCode = 1;
        try { await mongoose.disconnect(); } catch (_) {}
    })
    .finally(async () => {
        try { await mongoose.disconnect(); } catch (_) {}
    });
