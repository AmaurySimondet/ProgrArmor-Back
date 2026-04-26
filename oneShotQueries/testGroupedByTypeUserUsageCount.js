/**
 * Reproduit le call:
 * GET /user/variation/grouped-by-type?sortBy=recommended&userId=...&page=1&limit=8&isExercice=true&typesPage=1&typesLimit=6
 *
 * Vérifie ensuite, pour les variations renvoyées:
 * - présence/format de userUsageCountExact et userUsageCountRecommended
 * - cohérence avec un vrai aggregate SeanceSet (count all slots)
 *
 * Usage:
 *   node oneShotQueries/testGroupedByTypeUserUsageCount.js [userId]
 */
const mongoose = require('mongoose');
require('dotenv').config();

const variationLib = require('../lib/variation');
const SeanceSet = mongoose.models.Seanceset || mongoose.model('Seanceset');

const DEFAULT_USER_ID = '6365489f44d4b4000470882b';

function displayName(v) {
    return v?.name?.fr || v?.name?.en || String(v?._id || '(no-id)');
}

async function loadGroundTruthUsageMap(userId, variationIds) {
    if (!variationIds.length) return new Map();
    const rows = await SeanceSet.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        { $unwind: '$variations' },
        { $match: { 'variations.variation': { $in: variationIds } } },
        {
            $group: {
                _id: '$variations.variation',
                count: { $sum: 1 }
            }
        }
    ]);
    return new Map(rows.map((r) => [String(r._id), Number(r.count || 0)]));
}

async function main() {
    const userId = process.argv[2] || DEFAULT_USER_ID;
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);

    try {
        const params = {
            sortBy: 'recommended',
            page: 1,
            limit: 8,
            verified: undefined,
            isExercice: true,
            detailWeightType: undefined,
            type: undefined,
            typesPage: 1,
            typesLimit: 6,
            userId
        };

        const t0 = Date.now();
        const { groups, totalTypes } = await variationLib.getVariationsGroupedByType(
            params.sortBy,
            params.page,
            params.limit,
            params.verified,
            params.isExercice,
            params.detailWeightType,
            params.type,
            params.typesPage,
            params.typesLimit,
            params.userId
        );
        const elapsedMs = Date.now() - t0;

        const variations = groups.flatMap((g) => g.variations || []);
        const variationIds = variations
            .map((v) => v?._id)
            .filter(Boolean)
            .map((id) => new mongoose.Types.ObjectId(id));

        const truthMap = await loadGroundTruthUsageMap(userId, variationIds);

        const missingExactField = [];
        const nullExactField = [];
        const missingRecommendedField = [];
        const nullRecommendedField = [];
        const mismatches = [];
        const positives = [];

        variations.forEach((v) => {
            const id = String(v._id);
            const returnedExact = v.userUsageCountExact;
            const returnedRecommended = v.userUsageCountRecommended;
            const truth = Number(truthMap.get(id) || 0);

            if (!Object.prototype.hasOwnProperty.call(v, 'userUsageCountExact')) {
                missingExactField.push({ id, name: displayName(v), truth });
            } else if (returnedExact === null) {
                nullExactField.push({ id, name: displayName(v), truth });
            } else if (Number(returnedExact) !== truth) {
                mismatches.push({
                    id,
                    name: displayName(v),
                    returned: Number(returnedExact),
                    truth
                });
            }
            if (!Object.prototype.hasOwnProperty.call(v, 'userUsageCountRecommended')) {
                missingRecommendedField.push({ id, name: displayName(v), truth });
            } else if (returnedRecommended === null) {
                nullRecommendedField.push({ id, name: displayName(v), truth });
            }

            if (truth > 0) {
                positives.push({
                    id,
                    name: displayName(v),
                    returnedExact: Number(returnedExact),
                    returnedRecommended: Number(returnedRecommended),
                    truth
                });
            }
        });

        console.log('\n=== INPUT ===');
        console.log({
            endpoint: '/user/variation/grouped-by-type',
            query: {
                sortBy: 'recommended',
                userId,
                page: 1,
                limit: 8,
                isExercice: true,
                typesPage: 1,
                typesLimit: 6
            }
        });

        console.log('\n=== RESPONSE SHAPE ===');
        console.log({
            elapsedMs,
            totalTypes,
            groupsReturned: groups.length,
            variationsReturned: variations.length
        });

        console.log('\n=== CHECKS ===');
        console.log({
            missingExactFieldCount: missingExactField.length,
            nullExactFieldCount: nullExactField.length,
            missingRecommendedFieldCount: missingRecommendedField.length,
            nullRecommendedFieldCount: nullRecommendedField.length,
            mismatchCount: mismatches.length
        });

        if (missingExactField.length) {
            console.log('\n--- Missing userUsageCountExact (top 10) ---');
            missingExactField.slice(0, 10).forEach((row, i) => {
                console.log(`${i + 1}. ${row.id} | ${row.name} | truth=${row.truth}`);
            });
        }

        if (nullExactField.length) {
            console.log('\n--- Null userUsageCountExact (top 10) ---');
            nullExactField.slice(0, 10).forEach((row, i) => {
                console.log(`${i + 1}. ${row.id} | ${row.name} | truth=${row.truth}`);
            });
        }

        if (missingRecommendedField.length) {
            console.log('\n--- Missing userUsageCountRecommended (top 10) ---');
            missingRecommendedField.slice(0, 10).forEach((row, i) => {
                console.log(`${i + 1}. ${row.id} | ${row.name} | truth=${row.truth}`);
            });
        }

        if (nullRecommendedField.length) {
            console.log('\n--- Null userUsageCountRecommended (top 10) ---');
            nullRecommendedField.slice(0, 10).forEach((row, i) => {
                console.log(`${i + 1}. ${row.id} | ${row.name} | truth=${row.truth}`);
            });
        }

        if (mismatches.length) {
            console.log('\n--- Mismatches returned vs truth (top 20) ---');
            mismatches.slice(0, 20).forEach((row, i) => {
                console.log(`${i + 1}. ${row.id} | ${row.name} | returned=${row.returned} | truth=${row.truth}`);
            });
        }

        console.log('\n=== VARIATIONS WITH TRUTH > 0 (top 20) ===');
        positives.slice(0, 20).forEach((row, i) => {
            console.log(
                `${i + 1}. ${row.id} | ${row.name} | returnedExact=${row.returnedExact} | returnedRecommended=${row.returnedRecommended} | truth=${row.truth}`
            );
        });
    } finally {
        await mongoose.connection.close();
    }
}

main().catch((err) => {
    console.error('Erreur testGroupedByTypeUserUsageCount:', err);
    process.exitCode = 1;
});
