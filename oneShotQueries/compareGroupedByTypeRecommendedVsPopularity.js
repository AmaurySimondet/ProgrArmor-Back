/**
 * Compare sortBy=recommended vs popularity sur getVariationsGroupedByType (mêmes params qu’un GET).
 * Usage: node oneShotQueries/compareGroupedByTypeRecommendedVsPopularity.js [userId]
 */
const mongoose = require('mongoose');
require('dotenv').config();

const variation = require('../lib/variation');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';

function typeLabel(t) {
    return t?.name?.fr || t?.name?.en || String(t?._id || '');
}

function varLabel(v) {
    return v?.name?.fr || v?.name?.en || String(v?._id || '');
}

async function runOnce(sortBy, userId) {
    const t0 = Date.now();
    const { groups, totalTypes } = await variation.getVariationsGroupedByType(
        sortBy,
        1,
        8,
        undefined,
        true,
        undefined,
        undefined,
        1,
        6,
        userId
    );
    const ms = Date.now() - t0;
    return { groups, totalTypes, ms };
}

function printSnapshot(label, { groups, totalTypes, ms }) {
    console.log(`\n=== ${label} (${ms}ms, totalTypes=${totalTypes}) ===`);
    const typeSlice = groups.slice(0, 4);
    typeSlice.forEach((g, i) => {
        console.log(`  Type ${i + 1}: ${typeLabel(g.type)} | popularityScore=${g.type?.popularityScore ?? 'n/a'}`);
        const exos = (g.variations || []).slice(0, 5);
        exos.forEach((v, j) => {
            console.log(`    ${j + 1}. ${varLabel(v)} | pop=${v.popularity ?? 'n/a'}`);
        });
    });
}

async function main() {
    const userId = process.argv[2] || DEFAULT_USER_ID;
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    try {
        const pop = await runOnce('popularity', userId);
        const rec = await runOnce('recommended', userId);

        printSnapshot('sortBy=popularity', pop);
        printSnapshot('sortBy=recommended', rec);
    } finally {
        await mongoose.connection.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
