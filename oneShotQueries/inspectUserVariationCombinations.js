/**
 * Liste les combinaisons uniques de variations.variation par ligne de série (seanceset),
 * pour repérer les exos / combos les plus loggés.
 *
 * Deux signatures :
 * - ordre conservé (comme dans le document) ;
 * - ensemble trié (mêmes IDs, ordre différent = même clé).
 *
 * Usage: node oneShotQueries/inspectUserVariationCombinations.js [userId] [topN]
 */
const mongoose = require('mongoose');
require('dotenv').config();

const SeanceSet = require('../schema/seanceset');
const Variation = require('../schema/variation');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';
const DEFAULT_TOP = 40;

function inc(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function formatComboLine(sig, count, nameById) {
    const ids = sig.split('|').filter(Boolean);
    const labels = ids.map((id) => nameById.get(id) || id.slice(-8));
    return `${String(count).padStart(5)}×  ${labels.join(' + ')}`;
}

async function loadNamesForSignatures(topEntries) {
    const idSet = new Set();
    for (const [sig] of topEntries) {
        for (const id of sig.split('|')) {
            if (id) idSet.add(id);
        }
    }
    const ids = [...idSet].map((s) => new mongoose.Types.ObjectId(s));
    if (ids.length === 0) return new Map();
    const docs = await Variation.find({ _id: { $in: ids } }, { name: 1 }).lean();
    return new Map(docs.map((d) => [d._id.toString(), d.name?.fr || d.name?.en || '']));
}

async function main() {
    const userId = process.argv[2] || DEFAULT_USER_ID;
    const topN = Math.max(1, parseInt(process.argv[3], 10) || DEFAULT_TOP);

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    try {
        const uid = new mongoose.Types.ObjectId(userId);
        const byOrder = new Map();
        const bySortedSet = new Map();
        let totalSets = 0;
        let skippedEmpty = 0;

        const cursor = SeanceSet.find({ user: uid }, { variations: 1 }).lean().cursor();
        for await (const doc of cursor) {
            totalSets += 1;
            const ordered = (doc.variations || [])
                .map((v) => v.variation?.toString())
                .filter(Boolean);
            if (ordered.length === 0) {
                skippedEmpty += 1;
                continue;
            }
            inc(byOrder, ordered.join('|'));
            inc(bySortedSet, [...new Set(ordered)].sort().join('|'));
        }

        const uniqueOrdered = byOrder.size;
        const uniqueSorted = bySortedSet.size;

        console.log(`User ${userId}`);
        console.log(`Lignes de séries (seancesets): ${totalSets}`);
        console.log(`Sans variations.variation: ${skippedEmpty}`);
        console.log(`Combinaisons uniques (ordre conservé): ${uniqueOrdered}`);
        console.log(`Combinaisons uniques (ensemble trié): ${uniqueSorted}`);
        console.log('');

        const topOrdered = [...byOrder.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
        const topSorted = [...bySortedSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);

        const nameById = await loadNamesForSignatures([...topOrdered, ...topSorted]);

        console.log(`--- Top ${topN} (ordre exact dans variations[]) ---`);
        topOrdered.forEach(([sig, c]) => {
            console.log(formatComboLine(sig, c, nameById));
        });

        console.log('');
        console.log(`--- Top ${topN} (même set d’IDs, ordre ignoré) ---`);
        topSorted.forEach(([sig, c]) => {
            console.log(formatComboLine(sig, c, nameById));
        });
    } finally {
        await mongoose.connection.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
