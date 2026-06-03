/**
 * Diagnostic use case : user 6365489f44d4b4000470882b, recherche "Curl poignets".
 *
 * Usage:
 *   node oneShotQueries/debugWorkoutDetailCurlPoignets.js
 *   node oneShotQueries/debugWorkoutDetailCurlPoignets.js <contextVariationId>
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');
const variationLib = require('../lib/variation');
const set = require('../lib/set');

const USER_ID = process.env.WORKOUT_DETAIL_TEST_USER_ID || '6365489f44d4b4000470882b';
const SEARCH = 'Curl poignets';
const WEIGHT_TYPE = 'external_free';
const MAX_DEPTH = 4;
const DEFAULT_WRIST_CONTEXT_ID = '6922144e1c858345acc2d16c';

function tokenizeExact(value) {
    const { normalizeString } = require('../utils/string');
    const { SEARCH_STOPWORDS } = require('../constants').search;
    const normalized = normalizeString(value || '');
    return normalized
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token && token.length >= 3 && !SEARCH_STOPWORDS.has(token));
}

function scoreBreakdown(item, context) {
    const familySeedIds = context.familySeedIds || [];
    const searchTokens = context.searchTokens || [];
    const maxCount = Math.max(1, context.maxCount || 1);
    const performedSet = new Set((item.variationIds || []).map(String));
    let eqDepth = 0;
    for (const id of familySeedIds) {
        if (performedSet.has(String(id))) eqDepth += 1;
        else break;
    }
    const eqScore = variationLib.getContextPrefixOverlapScore(
        item.variationIds,
        familySeedIds,
        context.contextVariationId
    );
    const labelTokens = new Set(tokenizeExact(String(item.label || '')));
    const nameMatches = searchTokens.filter((t) => labelTokens.has(t));
    const nameScore = variationLib.getPerformedSuggestionNameScore(item, searchTokens);
    const countScore = variationLib.getPerformedSuggestionCountScore?.(item.count, maxCount)
        ?? (Number(item.count || 0) / maxCount);
    const total = variationLib.scorePerformedWorkoutSuggestionItem(item, {
        searchTokens,
        familySeedIds,
        maxCount,
        contextVariationId: context.contextVariationId
    });
    return { eqDepth, eqScore, nameMatches, nameScore, countScore, total };
}

async function findWristCurlContextCandidates() {
    const rx = /poignet|wrist/i;
    const docs = await Variation.find(
        {
            isExercice: true,
            $or: [{ 'name.fr': rx }, { 'name.en': rx }]
        },
        { name: 1, equivalentTo: 1, picture: 1, verified: 1 }
    )
        .limit(40)
        .lean();

    return docs.filter((d) => {
        const fr = String(d?.name?.fr || '');
        const en = String(d?.name?.en || '');
        return /curl/i.test(fr) || /curl/i.test(en);
    });
}

async function resolveContextId(cliOverride) {
    if (cliOverride && mongoose.Types.ObjectId.isValid(cliOverride)) {
        return String(cliOverride);
    }
    const candidates = await findWristCurlContextCandidates();
    console.log('\n=== Candidats exercice curl + poignets/wrist ===');
    candidates.forEach((d, i) => {
        const fr = d?.name?.fr || '';
        const en = d?.name?.en || '';
        const eqLen = (d.equivalentTo || []).length;
        console.log(
            `${i + 1}. ${d._id} | fr="${fr}" en="${en}" | eqLen=${eqLen} picture=${Boolean(d.picture)}`
        );
    });
    const preferred = candidates.find((d) => /poignet|wrist/i.test(String(d?.name?.fr || d?.name?.en || '')));
    return preferred ? String(preferred._id) : DEFAULT_WRIST_CONTEXT_ID;
}

async function run() {
    const cliContext = process.argv[2] || process.env.WORKOUT_DETAIL_WRIST_CONTEXT_ID || '';
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);

    try {
        const contextVariationId = await resolveContextId(cliContext);
        const contextDoc = await Variation.findById(contextVariationId, { name: 1, equivalentTo: 1, isExercice: 1 }).lean();
        const familySeedIds = set.resolveFamilySeedIds(contextVariationId, contextDoc);

        console.log('\n=== CONTEXTE ===');
        console.log({
            userId: USER_ID,
            contextVariationId,
            contextNameFr: contextDoc?.name?.fr,
            contextNameEn: contextDoc?.name?.en,
            familySeedIds,
            search: SEARCH
        });

        const query = {
            userId: USER_ID,
            contextVariationId,
            search: SEARCH,
            weightType: WEIGHT_TYPE,
            page: 1,
            limit: 30,
            maxDepth: MAX_DEPTH
        };

        const payload = await variationLib.getWorkoutDetailSuggestions(query);
        const suggestions = payload.suggestions || [];
        const tier1 = suggestions.filter((s) => s.kind === 'performed' && s.tier === 1);
        const searchTokens = tokenizeExact(SEARCH);
        const maxCount = Math.max(...tier1.map((t) => Number(t.count || 0)), 1);
        const scoreCtx = { familySeedIds, searchTokens, maxCount, contextVariationId };

        console.log('\n=== META API ===');
        console.log(payload.meta);

        console.log('\n=== STRUCTURE PAGE (tiers) ===');
        console.log(suggestions.map((s) => s.tier).join(','));

        console.log('\n=== TOP 15 SUGGESTIONS ===');
        suggestions.slice(0, 15).forEach((item, i) => {
            const b = item.kind === 'performed'
                ? scoreBreakdown(item, scoreCtx)
                : null;
            const extra = item.kind === 'performed'
                ? `score=${b.total.toFixed(3)} eq=${b.eqScore.toFixed(2)} name=${b.nameScore.toFixed(2)} count=${b.countScore.toFixed(2)} pic=${item.resolvedPicture ? 'resolved' : 'none'}`
                : `tier=${item.tier}`;
            console.log(`${i + 1}. [${item.kind}] ${extra} | "${item.label || item?.variation?.name?.fr}"`);
        });

        const firstWristIdx = suggestions.findIndex((t) => /poignet|wrist/i.test(String(t.label || t?.variation?.name?.fr || '')));
        const firstBicepsIdx = suggestions.findIndex((t) => /biceps|bicep/i.test(String(t.label || '')));
        console.log('\n=== POIGNETS vs BICEPS (liste complète page) ===');
        console.log(`index premier poignets/wrist: ${firstWristIdx}`);
        console.log(`index premier biceps: ${firstBicepsIdx}`);
        if (firstWristIdx >= 0 && firstBicepsIdx >= 0) {
            console.log(`poignets avant biceps: ${firstWristIdx < firstBicepsIdx ? 'OK' : 'FAIL'}`);
            if (firstWristIdx >= firstBicepsIdx) process.exitCode = 1;
        }

        const tier1NoPic = tier1.filter((t) => !t.resolvedPicture && !getLocalPic(t));
        console.log('\n=== IMAGES (tier1) ===');
        console.log(`tier1: ${tier1.length}, sans image après resolve: ${tier1NoPic.length}`);
        tier1NoPic.slice(0, 5).forEach((t) => {
            console.log(`  - "${t.label}"`);
        });

        const top5Tier1 = suggestions.filter((s) => s.kind === 'performed').slice(0, 5);
        const top5HasWrist = top5Tier1.some((t) => /poignet|wrist/i.test(String(t.label || '')));
        console.log(`\nTop 5 performed contient poignets/wrist: ${top5HasWrist ? 'OK' : 'FAIL'}`);
        if (!top5HasWrist) process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

function getLocalPic(item) {
    const cv = item?.cardVariation;
    if (!cv) return null;
    if (cv.picture) return cv.picture;
    if (Array.isArray(cv.variations)) {
        return cv.variations.find((v) => v?.picture)?.picture || null;
    }
    return null;
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
