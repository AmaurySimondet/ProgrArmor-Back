const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
if (!uri) {
    throw new Error('Missing env var: mongoURL');
}

const DEFAULT_BWR = 0.85;
const ABS_LOMBAIRES_TYPE_ID = '669cee980c89e9434327caaa';

function getDbName() {
    if (process.env.DATABASE_NAME) return process.env.DATABASE_NAME;
    if (process.env.DATABASE) return process.env.DATABASE.split('/').pop().split('?')[0];
    throw new Error('Missing DATABASE_NAME or DATABASE in environment variables');
}

function normalize(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

const EXPLICIT_WEIGHT_TYPE_RULES = [
    { label: 'extension triceps', targetWeightType: 'external_machine' },
    { label: 'extension triceps corde', targetWeightType: 'external_machine' },
    { label: 'extension triceps prise inversée', targetWeightType: 'external_machine' },
    { label: 'rowing inversé', targetWeightType: 'bodyweight_plus_external' },
    { label: 'adbuction de hanche', targetWeightType: 'external_machine' },
    { label: 'adduction de hanche', targetWeightType: 'external_machine' },
    { label: 'presse horizontale', targetWeightType: 'external_machine' },
    { label: 'hack squat', targetWeightType: 'external_machine' },
    { label: 'presse a une jambe', targetWeightType: 'external_machine' },
    { label: 'extension mollets presse inclinee', targetWeightType: 'external_machine' },
    { label: "extension mollets à l'âne", targetWeightType: 'external_machine' },
    { label: 'presse verticale', targetWeightType: 'external_machine' },
    { label: 'extension mollets assis une jambe', targetWeightType: 'external_machine' },
    { label: 'belt squat', targetWeightType: 'external_machine' },
    { label: 'jumping jack', targetWeightType: 'bodyweight_plus_external' }
];

const ABS_LOMBAIRES_BODYWEIGHT_IDS = new Set([
    '669ced7e665a3ffe7771439a', // Crunchs
    '692214521c858345acc2d347', // Grimpeur
    '669c3609218324e0b7682b49', // Superman
    '692214501c858345acc2d28b', // Crunchs inversés
    '692214521c858345acc2d344', // Battements de jambes
    '692214531c858345acc2d3eb', // Maintien Superman / Arc
    '692214531c858345acc2d3e8', // Hollow Hold
    '692081fef94b17a153ce44c5', // V-Up
    '6922144f1c858345acc2d1ef', // Crunchs déclinés
    '6922144f1c858345acc2d21a', // Crunchs latéraux
    '692214511c858345acc2d2e7', // Flexions latérales chaise romaine
    '692214531c858345acc2d3f7', // Around the World
    '669ced7e665a3ffe777143a2', // Hyperextensions inversées
    '669ced7e665a3ffe7771439c', // Hollow Body
    '669ced7e665a3ffe77714399', // Boat Hold
    '669ced7e665a3ffe777143a0', // Toes touch crunches
    '669ced7e665a3ffe777143a8', // Flexions latérales
    '669ced7e665a3ffe777143a7', // Nageur
    '669ced7e665a3ffe777143a6' // Jacknife
]);

function buildSetUnset(targetWeightType, doc) {
    const set = { weightType: targetWeightType };
    const unset = {};

    if (targetWeightType === 'bodyweight_plus_external') {
        set.includeBodyweight = true;
        if (typeof doc.exerciseBodyWeightRatio !== 'number') {
            set.exerciseBodyWeightRatio = DEFAULT_BWR;
        }
    } else {
        set.includeBodyweight = false;
        if (typeof doc.exerciseBodyWeightRatio === 'number') {
            unset.exerciseBodyWeightRatio = '';
        }
    }

    return { set, unset };
}

async function run() {
    const apply = process.argv.includes('--apply');
    const client = new MongoClient(uri);
    const dbName = getDbName();
    const rulesByNormalizedLabel = new Map(
        EXPLICIT_WEIGHT_TYPE_RULES.map((rule) => [normalize(rule.label), rule.targetWeightType])
    );

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('variations');

        const explicitDocs = await collection
            .find({ isExercice: true })
            .project({
                _id: 1,
                name: 1,
                normalizedName: 1,
                type: 1,
                weightType: 1,
                includeBodyweight: 1,
                exerciseBodyWeightRatio: 1
            })
            .toArray();

        const matchedExplicit = new Set();
        const explicitPlanned = [];

        for (const doc of explicitDocs) {
            const labels = [
                normalize(doc?.name?.fr),
                normalize(doc?.name?.en),
                normalize(doc?.normalizedName?.fr),
                normalize(doc?.normalizedName?.en)
            ].filter(Boolean);
            const targetWeightType = labels.map((label) => rulesByNormalizedLabel.get(label)).find(Boolean);
            if (!targetWeightType) continue;

            labels.forEach((label) => {
                if (rulesByNormalizedLabel.has(label)) matchedExplicit.add(label);
            });

            const { set, unset } = buildSetUnset(targetWeightType, doc);
            const needsUpdate =
                doc.weightType !== targetWeightType ||
                doc.includeBodyweight !== set.includeBodyweight ||
                (targetWeightType === 'bodyweight_plus_external' && typeof doc.exerciseBodyWeightRatio !== 'number') ||
                (targetWeightType !== 'bodyweight_plus_external' && typeof doc.exerciseBodyWeightRatio === 'number');

            if (!needsUpdate) continue;
            explicitPlanned.push({ doc, set, unset, reason: 'explicit-rule' });
        }

        const explicitMissing = EXPLICIT_WEIGHT_TYPE_RULES
            .filter((rule) => !matchedExplicit.has(normalize(rule.label)))
            .map((rule) => rule.label);

        const absDocs = await collection
            .find({
                _id: { $in: [...ABS_LOMBAIRES_BODYWEIGHT_IDS].map((id) => new ObjectId(id)) },
                type: new ObjectId(ABS_LOMBAIRES_TYPE_ID),
                isExercice: true
            })
            .project({
                _id: 1,
                name: 1,
                weightType: 1,
                includeBodyweight: 1,
                exerciseBodyWeightRatio: 1
            })
            .toArray();

        const absPlanned = [];
        for (const doc of absDocs) {
            const { set, unset } = buildSetUnset('bodyweight_plus_external', doc);
            const needsUpdate =
                doc.weightType !== 'bodyweight_plus_external' ||
                doc.includeBodyweight !== true ||
                typeof doc.exerciseBodyWeightRatio !== 'number';
            if (!needsUpdate) continue;
            absPlanned.push({ doc, set, unset, reason: 'abs-lombaires-bodyweight' });
        }

        const plansById = new Map();
        for (const plan of [...explicitPlanned, ...absPlanned]) {
            plansById.set(String(plan.doc._id), plan);
        }
        const plans = [...plansById.values()];

        console.log(`Database: ${dbName}`);
        console.log(`Planned updates total: ${plans.length}`);
        console.log(`- from explicit rules: ${explicitPlanned.length}`);
        console.log(`- from abs/lombaires bodyweight set: ${absPlanned.length}`);

        if (explicitMissing.length > 0) {
            console.log('Explicit labels not matched in DB:');
            explicitMissing.forEach((label) => console.log(`- ${label}`));
        }

        for (const plan of plans) {
            const name = plan?.doc?.name?.fr || plan?.doc?.name?.en || 'Unnamed';
            console.log(`- PLAN ${plan.doc._id} | ${name} | ${plan.reason}`);
            console.log(`  set: ${JSON.stringify(plan.set)}`);
            if (Object.keys(plan.unset).length > 0) {
                console.log(`  unset: ${JSON.stringify(plan.unset)}`);
            }

            if (apply) {
                const update = { $set: plan.set };
                if (Object.keys(plan.unset).length > 0) {
                    update.$unset = plan.unset;
                }
                await collection.updateOne({ _id: plan.doc._id }, update);
            }
        }

        if (!apply) {
            console.log('Dry-run mode. Re-run with --apply to persist changes.');
        } else {
            console.log('Updates applied.');
        }
    } finally {
        await client.close();
    }
}

run().catch((error) => {
    console.error('fixWeightTypeBatchApril2026 failed:', error.message);
    process.exitCode = 1;
});
