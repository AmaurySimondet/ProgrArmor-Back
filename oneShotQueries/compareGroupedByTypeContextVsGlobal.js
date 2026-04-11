/**
 * Compare getVariationsGroupedByType (détails, sortBy=recommended) sans vs avec contextVariationId.
 * Affiche ordre des types + premiers détails par type, timings, et un flag d’égalité stricte.
 *
 * Usage:
 *   node oneShotQueries/compareGroupedByTypeContextVsGlobal.js [userId] [contextVariationId]
 */
const mongoose = require('mongoose');
require('dotenv').config();

const variation = require('../lib/variation');

const DEFAULT_USER = '6365489f44d4b4000470882b';
const DEFAULT_CONTEXT = '669ced7e665a3ffe77714374';

function typeKey(g) {
    return g.type?.name?.fr || String(g.type?._id || '');
}

function snapshot(groups) {
    return groups.map((g) => ({
        type: typeKey(g),
        variations: (g.variations || []).map((v) => v.name?.fr || String(v._id))
    }));
}

function snapshotsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function printSideBySide(labelA, snapA, labelB, snapB) {
    const n = Math.max(snapA.length, snapB.length);
    console.log(`\n${'='.repeat(100)}`);
    console.log(
        `${labelA.padEnd(48)} | ${labelB}`
    );
    console.log('='.repeat(100));
    for (let i = 0; i < n; i++) {
        const ra = snapA[i];
        const rb = snapB[i];
        const left = ra ? `${ra.type} → ${ra.variations.slice(0, 5).join(', ')}` : '—';
        const right = rb ? `${rb.type} → ${rb.variations.slice(0, 5).join(', ')}` : '—';
        console.log(`${left.slice(0, 47).padEnd(48)}| ${right}`);
    }
}

async function runOnce(userId, contextVariationId) {
    const t0 = Date.now();
    const { groups, totalTypes } = await variation.getVariationsGroupedByType(
        'recommended',
        1,
        8,
        undefined,
        false,
        'external_free',
        undefined,
        1,
        6,
        userId,
        undefined,
        undefined,
        undefined,
        undefined,
        contextVariationId
    );
    const ms = Date.now() - t0;
    return { groups, totalTypes, ms, snap: snapshot(groups) };
}

async function main() {
    const userId = process.argv[2] || DEFAULT_USER;
    const contextId = process.argv[3] || DEFAULT_CONTEXT;

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    try {
        console.log(`userId=${userId}`);
        console.log(`contextVariationId (Squat test)=${contextId}`);

        const globalRes = await runOnce(userId, undefined);
        const ctxRes = await runOnce(userId, contextId);

        console.log(`\nTimings: global ${globalRes.ms}ms | avec contexte ${ctxRes.ms}ms`);
        console.log(`totalTypes: global ${globalRes.totalTypes} | avec contexte ${ctxRes.totalTypes}`);

        const equal = snapshotsEqual(globalRes.snap, ctxRes.snap);
        console.log(`\nSnapshot strictement identique ? ${equal ? 'OUI (d’où « aucune différence » côté UI)' : 'NON'}`);

        printSideBySide(
            'GLOBAL (sans contextVariationId)',
            globalRes.snap,
            `CONTEXT (${contextId.slice(-8)}…)`,
            ctxRes.snap
        );

        if (equal) {
            console.log(
                '\nNote: même ordre possible si tes détails les plus « recommandés » globalement sont souvent les mêmes que ceux utilisés avec ce squat / ses variantes equivalentTo.'
            );
        }
    } finally {
        await mongoose.connection.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
