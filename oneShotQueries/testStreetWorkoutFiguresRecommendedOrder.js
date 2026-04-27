/**
 * Audit complet de /user/variation/grouped-by-type pour les "street workout figures" d'un user.
 *
 * Objectifs:
 * 1) Reproduire la réponse recommandée avec pagination complète.
 * 2) Observer l'ordre final complet.
 * 3) Vérifier si des exos réalisés (userUsageCountRecommended > 0) apparaissent bas.
 * 4) Comparer avec la vérité terrain (usage réel SeanceSet) pour conclure sur la logique.
 *
 * Usage:
 *   node oneShotQueries/testStreetWorkoutFiguresRecommendedOrder.js [userId] [typeId(optional)] [weightType(optional)]
 */
const mongoose = require('mongoose');
require('dotenv').config();

const variationLib = require('../lib/variation');
const Type = require('../schema/type');
const SeanceSet = mongoose.models.Seanceset || mongoose.model('Seanceset');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';
const DEFAULT_WEIGHT_TYPE = 'bodyweight_plus_external';
const PAGE_LIMIT = 8;
const HARD_MAX_PAGES = 80;

function label(v) {
    return v?.name?.fr || v?.name?.en || String(v?._id || '');
}

async function resolveStreetWorkoutFiguresTypeId(explicitTypeId) {
    if (explicitTypeId) return explicitTypeId;

    const candidates = await Type.find(
        {
            $or: [
                { 'name.fr': /street/i },
                { 'name.en': /street/i },
                { 'name.fr': /figure/i },
                { 'name.en': /figure/i }
            ]
        },
        { _id: 1, name: 1, popularityScore: 1 }
    )
        .sort({ popularityScore: -1, 'name.fr': 1 })
        .lean();

    if (!candidates.length) {
        throw new Error('Aucun type trouvé avec street/figure.');
    }

    const strict = candidates.find((t) => {
        const fr = String(t?.name?.fr || '').toLowerCase();
        const en = String(t?.name?.en || '').toLowerCase();
        return (fr.includes('street') || en.includes('street')) && (fr.includes('figure') || en.includes('figure'));
    });

    const picked = strict || candidates[0];
    console.log('\n=== TYPE CANDIDATES (top 10) ===');
    candidates.slice(0, 10).forEach((t, i) => {
        console.log(
            `${i + 1}. ${t._id} | fr="${t?.name?.fr || ''}" | en="${t?.name?.en || ''}" | popularityScore=${Number(t?.popularityScore || 0)}`
        );
    });
    console.log(`\nType retenu: ${picked._id} | ${picked?.name?.fr || picked?.name?.en}`);

    return String(picked._id);
}

async function fetchAllPagesForType({ userId, typeId, weightType }) {
    const rows = [];
    let page = 1;
    let totalVariations = null;
    let safety = 0;

    while (safety < HARD_MAX_PAGES) {
        const t0 = Date.now();
        const { groups, totalTypes } = await variationLib.getVariationsGroupedByType(
            'recommended',
            page,
            PAGE_LIMIT,
            undefined,
            true,
            weightType,
            typeId,
            1,
            1,
            userId
        );
        const ms = Date.now() - t0;

        const group = groups?.[0];
        const pageVariations = group?.variations || [];
        if (totalVariations === null) {
            totalVariations = Number(group?.totalVariations || 0);
        }

        console.log(
            `Page ${page}: totalTypes=${totalTypes}, totalVariations(type)=${totalVariations}, returned=${pageVariations.length}, ${ms}ms`
        );

        pageVariations.forEach((v, idx) => {
            rows.push({
                rank: (page - 1) * PAGE_LIMIT + idx + 1,
                _id: String(v._id),
                name: label(v),
                popularity: Number(v?.popularity?.global ?? v?.popularity ?? 0),
                userUsageCountExact: Number(v?.userUsageCountExact || 0),
                userUsageCountRecommended: Number(v?.userUsageCountRecommended || 0)
            });
        });

        if (!pageVariations.length) break;
        if (rows.length >= totalVariations) break;
        page += 1;
        safety += 1;
    }

    return { rows, totalVariations: Number(totalVariations || 0) };
}

async function loadGroundTruthUsageForType({ userId, typeId, weightType }) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const typeObjectId = new mongoose.Types.ObjectId(typeId);

    const rows = await SeanceSet.aggregate([
        { $match: { user: userObjectId } },
        { $unwind: '$variations' },
        {
            $group: {
                _id: '$variations.variation',
                allSlotUsage: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: 'variations',
                localField: '_id',
                foreignField: '_id',
                as: 'variationDoc'
            }
        },
        { $unwind: '$variationDoc' },
        {
            $match: {
                'variationDoc.type': typeObjectId,
                'variationDoc.isExercice': true,
                ...(weightType ? { 'variationDoc.weightType': weightType } : {})
            }
        },
        {
            $project: {
                _id: 1,
                allSlotUsage: 1,
                name: '$variationDoc.name',
                popularity: '$variationDoc.popularity'
            }
        },
        { $sort: { allSlotUsage: -1, popularity: -1 } }
    ]);

    return rows.map((r) => ({
        _id: String(r._id),
        name: r?.name?.fr || r?.name?.en || String(r._id),
        allSlotUsage: Number(r.allSlotUsage || 0)
    }));
}

function printApiOrder(rows) {
    console.log('\n=== ORDRE COMPLET API (rank global) ===');
    rows.forEach((r) => {
        console.log(
            `${String(r.rank).padStart(3, ' ')}. ${r._id} | ${r.name} | rec=${r.userUsageCountRecommended} | exact=${r.userUsageCountExact} | pop=${r.popularity}`
        );
    });
}

function analyzeLowUsedPositions(rows) {
    const used = rows.filter((r) => r.userUsageCountRecommended > 0);
    const never = rows.filter((r) => r.userUsageCountRecommended === 0);
    const firstUnusedRank = never.length ? never[0].rank : null;
    const usedAfterFirstUnused = firstUnusedRank
        ? used.filter((r) => r.rank > firstUnusedRank)
        : [];
    const usedAfterPage1 = used.filter((r) => r.rank > PAGE_LIMIT);
    const lowerHalfStart = Math.floor(rows.length / 2) + 1;
    const usedLowerHalf = used.filter((r) => r.rank >= lowerHalfStart);

    console.log('\n=== ANALYSE POSITION DES EXOS REALISES (rec>0) ===');
    console.log({
        totalReturned: rows.length,
        usedCount: used.length,
        neverUsedCount: never.length,
        firstUnusedRank,
        usedAfterFirstUnusedCount: usedAfterFirstUnused.length,
        usedAfterPage1Count: usedAfterPage1.length,
        usedInLowerHalfCount: usedLowerHalf.length
    });

    if (usedAfterFirstUnused.length) {
        console.log('\n--- Exos realises classes APRES apparition des non-utilises (top 15) ---');
        usedAfterFirstUnused.slice(0, 15).forEach((r) => {
            console.log(`${r.rank}. ${r._id} | ${r.name} | rec=${r.userUsageCountRecommended}`);
        });
    }

    if (usedAfterPage1.length) {
        console.log('\n--- Exos realises classes au-dela de la page 1 (top 20) ---');
        usedAfterPage1.slice(0, 20).forEach((r) => {
            console.log(`${r.rank}. ${r._id} | ${r.name} | rec=${r.userUsageCountRecommended}`);
        });
    }
}

function compareApiVsGroundTruth(apiRows, truthRows) {
    const apiById = new Map(apiRows.map((r) => [r._id, r]));
    const missingUsedInApi = truthRows.filter((t) => !apiById.has(t._id));
    const presentWithLowRank = truthRows
        .map((t) => ({
            ...t,
            apiRank: apiById.get(t._id)?.rank || null,
            apiRecUsage: apiById.get(t._id)?.userUsageCountRecommended || 0
        }))
        .filter((t) => t.apiRank !== null && t.apiRank > PAGE_LIMIT);

    console.log('\n=== VERITE TERRAIN USAGE (SeanceSet all slots) ===');
    console.log({
        usedVariationsInType: truthRows.length,
        missingUsedInApiCount: missingUsedInApi.length,
        presentButAfterPage1Count: presentWithLowRank.length
    });

    if (missingUsedInApi.length) {
        console.log('\n--- Variations utilisees absentes du listing API (top 20) ---');
        missingUsedInApi.slice(0, 20).forEach((r) => {
            console.log(`${r._id} | ${r.name} | truthUsage=${r.allSlotUsage}`);
        });
    }

    if (presentWithLowRank.length) {
        console.log('\n--- Variations utilisees presentes mais basses (top 20 par usage terrain) ---');
        presentWithLowRank.slice(0, 20).forEach((r) => {
            console.log(`${r.apiRank}. ${r._id} | ${r.name} | truthUsage=${r.allSlotUsage} | apiRec=${r.apiRecUsage}`);
        });
    }
}

async function main() {
    const userId = process.argv[2] || DEFAULT_USER_ID;
    const explicitTypeId = process.argv[3] || undefined;
    const weightType = process.argv[4] || DEFAULT_WEIGHT_TYPE;

    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);
    try {
        const typeId = await resolveStreetWorkoutFiguresTypeId(explicitTypeId);
        console.log('\n=== INPUT ===');
        console.log({
            endpoint: '/user/variation/grouped-by-type',
            query: {
                sortBy: 'recommended',
                userId,
                page: 1,
                limit: PAGE_LIMIT,
                isExercice: true,
                typesPage: 1,
                typesLimit: 1,
                type: typeId,
                weightType
            }
        });

        const { rows, totalVariations } = await fetchAllPagesForType({ userId, typeId, weightType });
        console.log('\n=== COUVERTURE PAGINATION ===');
        console.log({ collected: rows.length, totalVariations });

        printApiOrder(rows);
        analyzeLowUsedPositions(rows);

        const truthRows = await loadGroundTruthUsageForType({ userId, typeId, weightType });
        compareApiVsGroundTruth(rows, truthRows);
    } finally {
        await mongoose.connection.close();
    }
}

main().catch((err) => {
    console.error('Erreur testStreetWorkoutFiguresRecommendedOrder:', err);
    process.exitCode = 1;
});
