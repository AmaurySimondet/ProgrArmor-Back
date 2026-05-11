/**
 * Reproduit GET /user/variation/search (params équivalents côté lib)
 * et mesure getVariationBySearch pour conclure sur latence + rang des résultats.
 *
 * Usage (depuis la racine du repo, avec .env chargé) :
 *   node oneShotQueries/testPompeArcherSearch.js
 *
 * Variables : MONGO_URL ou mongoURL, DATABASE (comme le reste du projet).
 */
const mongoose = require('mongoose');
const { performance } = require('perf_hooks');
require('dotenv').config();

const variation = require('../lib/variation');
const constants = require('../constants');

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }
    return mongoUrl + database;
}

/** Params alignés sur : GET .../variation/search?search=pompe+archer&page=3&sortBy=recommended&limit=8&isExercice=true&userId=6365489f44d4b4000470882b */
const CASE = {
    search: 'pompe archer',
    type: undefined,
    sortBy: 'recommended',
    page: 3,
    limit: 8,
    verified: undefined,
    isExercice: true,
    myExercices: undefined,
    userId: '6365489f44d4b4000470882b',
    detailWeightType: undefined,
    recommendedVariationPopularityWeight: undefined,
    recommendedVariationUsageWeight: undefined,
    contextVariationId: undefined,
    recommendedVariationSearchWeight: undefined,
    recommendedVariationMultiTokenWeight: undefined,
    muscle: undefined,
    weightType: undefined
};

function candidateLimitFromConstants() {
    const fromEnv = Number(process.env.GROUPED_BY_TYPE_RECOMMENDED_VARIATION_SEARCH_CANDIDATE_LIMIT);
    if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
    return constants.variation.GROUPED_BY_TYPE_RECOMMENDED.VARIATION_SEARCH_CANDIDATE_LIMIT;
}

function displayName(v) {
    return (v?.name?.fr || v?.name?.en || String(v?._id || '')).trim();
}

function looksLikePompesArcher(v) {
    const fr = String(v?.name?.fr || '').toLowerCase();
    const en = String(v?.name?.en || '').toLowerCase();
    const hit = (s) => /\bpompes\b/.test(s) && /\barcher\b/.test(s);
    return hit(fr) || hit(en);
}

async function runSearch(page, limit) {
    return variation.getVariationBySearch(
        CASE.search,
        CASE.type,
        CASE.sortBy,
        page,
        limit,
        CASE.verified,
        CASE.isExercice,
        CASE.myExercices,
        CASE.userId,
        CASE.detailWeightType,
        CASE.recommendedVariationPopularityWeight,
        CASE.recommendedVariationUsageWeight,
        CASE.contextVariationId,
        CASE.recommendedVariationSearchWeight,
        CASE.recommendedVariationMultiTokenWeight,
        CASE.muscle,
        CASE.weightType
    );
}

function formatMs(ms) {
    return `${ms.toFixed(2)} ms`;
}

async function main() {
    const uri = getMongoUri();
    await mongoose.connect(uri);

    const pool = candidateLimitFromConstants();
    console.log('--- testPompeArcherSearch ---');
    console.log('Mongo OK | pool candidats (recommended) ≈', pool);
    console.log('Params:', { ...CASE, userId: `${CASE.userId.slice(0, 8)}…` });

    // Warmup
    await runSearch(1, 1);

    const timings = [];
    const runs = 5;
    let lastPageResult = { variations: [], total: 0 };
    for (let i = 0; i < runs; i += 1) {
        const t0 = performance.now();
        lastPageResult = await runSearch(CASE.page, CASE.limit);
        timings.push(performance.now() - t0);
    }
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    const min = Math.min(...timings);
    const max = Math.max(...timings);

    const { variations, total } = lastPageResult;

    console.log('\n--- Latence (getVariationBySearch direct, après warmup) ---');
    console.log(`Runs: ${runs} | min: ${formatMs(min)} | avg: ${formatMs(avg)} | max: ${formatMs(max)}`);
    console.log('(Le ~407 ms côté HTTP inclut réseau + JSON + middleware ; comparer à avg ici.)');

    console.log('\n--- Page demandée ---');
    console.log(`total (liste ranked, max ≈ pool): ${total}`);
    console.log(`page ${CASE.page}, limit ${CASE.limit} → ${variations.length} ligne(s)`);
    variations.forEach((v, i) => {
        const globalIndex = (CASE.page - 1) * CASE.limit + i + 1;
        const flag = looksLikePompesArcher(v) ? '  << pompes archer ?' : '';
        console.log(`  [${globalIndex}] ${displayName(v)}${flag}`);
    });

    console.log('\n--- Rang global dans le pool (page 1, limit = pool) ---');
    const full = await runSearch(1, pool);
    const idx = full.variations.findIndex(looksLikePompesArcher);
    if (idx === -1) {
        console.log('Aucune variation dont le nom FR/EN matche /\\bpompes\\b + /\\barcher\\b dans les', full.variations.length, 'premiers résultats.');
    } else {
        console.log(`Trouvé à la position ${idx + 1} / ${full.variations.length}: "${displayName(full.variations[idx])}"`);
    }

    console.log('\n--- Conclusion ---');
    const lines = [];
    lines.push(
        `Latence serveur pure (lib) ~${avg.toFixed(0)} ms en moyenne sur ${runs} appels ; le client HTTP à ~407 ms est cohérent si on ajoute latence réseau et sérialisation.`
    );
    if (idx === -1) {
        lines.push(
            '« Pompes archer » (mot entier) n’apparaît pas dans le pool ranked : soit absent du catalogue sous ce libellé, soit hors top-N candidats Atlas, soit filtré par le tri recommended.'
        );
    } else {
        const onPage3 = idx >= (CASE.page - 1) * CASE.limit && idx < CASE.page * CASE.limit;
        lines.push(
            `« Pompes archer » est à la place ${idx + 1} dans le classement (pool ${full.variations.length}). ${
                onPage3 ? 'Elle tombe bien sur la page 3 demandée.' : 'La page 3 ne correspond pas à ce rang (pagination).'
            }`
        );
        if (idx >= 16 && idx < 24) {
            lines.push('Rang 17–24 : cohérent avec une visibilité « basse » sur la page 3 avec limit 8.');
        }
    }
    lines.push(
        'Rappel : avec sortBy=recommended, tokenCoverage compare « pompe » et « pompes » comme tokens distincts (voir tokenizeExact dans lib/variation.js), ce qui peut faire chuter l’exercice au classement.'
    );
    console.log(lines.join('\n'));

    await mongoose.connection.close();
    console.log('\n✅ Terminé');
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
    mongoose.connection.close().catch(() => {});
});
