const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.mongoURL;
if (!uri) {
    throw new Error('Missing env var: mongoURL');
}

function getDbName() {
    if (process.env.DATABASE_NAME) return process.env.DATABASE_NAME;
    if (process.env.DATABASE) return process.env.DATABASE.split('/').pop().split('?')[0];
    throw new Error('Missing DATABASE_NAME or DATABASE in environment variables');
}

function getDisplayName(doc) {
    return doc?.name?.fr || doc?.name?.en || 'Unnamed';
}

function formatEquivalentList(equivalentDocs) {
    if (!equivalentDocs.length) return '[]';
    return equivalentDocs
        .map((item, idx) => {
            const label = getDisplayName(item);
            return `${idx}. ${item._id} | ${label} | isExercice=${Boolean(item.isExercice)}`;
        })
        .join(' || ');
}

function getSuggestedOrder(equivalentDocs) {
    if (!equivalentDocs.length) return [];
    const exercises = equivalentDocs.filter((item) => Boolean(item.isExercice));
    const nonExercises = equivalentDocs.filter((item) => !item.isExercice);
    return [...exercises, ...nonExercises];
}

function normalizeForCompare(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

const TOKEN_EQUIVALENCE = {
    complet: 'full',
    complete: 'full',
    full: 'full',
    partiel: 'partial',
    partielle: 'partial',
    partial: 'partial',
    avance: 'advanced',
    avancee: 'advanced',
    advanced: 'advanced',
    debutant: 'beginner',
    debutante: 'beginner',
    beginner: 'beginner',
    one: 'one',
    un: 'one',
    une: 'one',
    leg: 'leg',
    jambe: 'leg',
    lean: 'lean',
    incline: 'lean',
    inclinee: 'lean',
    inclinees: 'lean',
    inclines: 'lean'
};

const IGNORED_TOKENS = new Set([
    'progression',
    'sequence'
]);

function canonicalizeToken(token) {
    return TOKEN_EQUIVALENCE[token] || token;
}

function getCanonicalTokens(value) {
    const normalized = normalizeForCompare(value);
    if (!normalized) return [];
    return normalized
        .split(' ')
        .filter(Boolean)
        .map((token) => canonicalizeToken(token))
        .filter((token) => !IGNORED_TOKENS.has(token));
}

function sortedTokenSignature(value) {
    const tokens = getCanonicalTokens(value);
    if (!tokens.length) return '';
    return tokens
        .slice()
        .sort()
        .join(' ');
}

function isSubset(subsetTokens, supersetTokens) {
    const superset = new Set(supersetTokens);
    return subsetTokens.every((token) => superset.has(token));
}

function hasTokenContainmentMatch(left, right) {
    const leftTokens = getCanonicalTokens(left);
    const rightTokens = getCanonicalTokens(right);
    if (!leftTokens.length || !rightTokens.length) return false;
    if (leftTokens.length <= rightTokens.length) {
        return isSubset(leftTokens, rightTokens);
    }
    return isSubset(rightTokens, leftTokens);
}

function isLooseNameMatch(left, right) {
    const leftNormalized = normalizeForCompare(left);
    const rightNormalized = normalizeForCompare(right);
    if (!leftNormalized || !rightNormalized) return false;
    if (leftNormalized === rightNormalized) return true;
    if (sortedTokenSignature(leftNormalized) === sortedTokenSignature(rightNormalized)) return true;
    return hasTokenContainmentMatch(leftNormalized, rightNormalized);
}

function joinEquivalentNames(equivalentDocs, lang) {
    return equivalentDocs
        .map((item) => item?.name?.[lang])
        .filter(Boolean)
        .join(' ');
}

function getNamingCheck(variation, equivalentDocs) {
    const variationFr = variation?.name?.fr || '';
    const variationEn = variation?.name?.en || '';
    const joinedFr = joinEquivalentNames(equivalentDocs, 'fr');
    const joinedEn = joinEquivalentNames(equivalentDocs, 'en');

    const frMatches = isLooseNameMatch(variationFr, joinedFr);
    const enMatches = isLooseNameMatch(variationEn, joinedEn);

    return {
        frMatches,
        enMatches,
        isMismatch: !frMatches || !enMatches,
        variationFr,
        variationEn,
        joinedFr,
        joinedEn
    };
}

async function run() {
    const client = new MongoClient(uri);
    const dbName = getDbName();
    const checkNaming = process.argv.includes('--check-naming');
    const applyOrder = process.argv.includes('--apply-order');

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('variations');

        const rows = await collection.aggregate([
            {
                $match: {
                    equivalentTo: { $exists: true, $type: 'array', $ne: [] }
                }
            },
            {
                $lookup: {
                    from: 'variations',
                    localField: 'equivalentTo',
                    foreignField: '_id',
                    as: 'equivalentToDocs'
                }
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    equivalentTo: 1,
                    equivalentToDocs: {
                        $map: {
                            input: '$equivalentTo',
                            as: 'eqId',
                            in: {
                                $let: {
                                    vars: {
                                        matchDoc: {
                                            $first: {
                                                $filter: {
                                                    input: '$equivalentToDocs',
                                                    as: 'doc',
                                                    cond: { $eq: ['$$doc._id', '$$eqId'] }
                                                }
                                            }
                                        }
                                    },
                                    in: {
                                        _id: '$$eqId',
                                        isExercice: '$$matchDoc.isExercice',
                                        name: '$$matchDoc.name'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        ]).toArray();

        console.log(`🧪 DB: ${dbName}`);
        console.log(`📦 Variations avec equivalentTo: ${rows.length}`);
        console.log(`🔤 Check naming: ${checkNaming ? 'ON' : 'OFF (default)'}`);
        console.log(`🛠️ Apply KO ORDER fix: ${applyOrder ? 'ON' : 'OFF (dry-run default)'}`);

        let warningCount = 0;
        let orderWarningCount = 0;
        let multiExerciseWarningCount = 0;
        let namingWarningCount = 0;
        let orderFixPlannedCount = 0;
        let orderFixAppliedCount = 0;
        for (const variation of rows) {
            const equivalentDocs = variation.equivalentToDocs || [];
            if (!equivalentDocs.length) continue;

            const firstIsExercise = Boolean(equivalentDocs[0]?.isExercice);
            const exerciseCount = equivalentDocs.filter((item) => Boolean(item.isExercice)).length;

            const namingCheck = checkNaming
                ? getNamingCheck(variation, equivalentDocs)
                : { isMismatch: false, frMatches: true, enMatches: true };
            const hasIssue = !firstIsExercise || exerciseCount > 1 || (checkNaming && namingCheck.isMismatch);
            if (!hasIssue) continue;

            warningCount += 1;
            const suggestedOrder = getSuggestedOrder(equivalentDocs);

            const namingCheckSuggested = checkNaming
                ? getNamingCheck(variation, suggestedOrder)
                : { isMismatch: false };

            console.warn(`\n🚨🚨 WARNING VARIATION 🚨🚨`);
            console.warn(`🆔 ${variation._id}`);
            console.warn(`🏷️ ${getDisplayName(variation)}`);
            if (!firstIsExercise) {
                orderWarningCount += 1;
                orderFixPlannedCount += 1;
                console.warn('❌ KO ORDER: equivalentTo[0] n\'est pas un exercice');
                if (applyOrder) {
                    const suggestedEquivalentIds = suggestedOrder.map((item) => item._id);
                    await collection.updateOne(
                        { _id: variation._id },
                        { $set: { equivalentTo: suggestedEquivalentIds } }
                    );
                    orderFixAppliedCount += 1;
                    console.warn('🛠️ ORDER FIX APPLIED: equivalentTo reordonne');
                } else {
                    console.warn('📝 ORDER FIX PLANNE: relancer avec --apply-order pour appliquer');
                }
            }
            if (exerciseCount > 1) {
                multiExerciseWarningCount += 1;
                console.warn(`❌ KO MULTI-EXERCISE: plusieurs exercices dans equivalentTo (${exerciseCount})`);
            }
            if (checkNaming && namingCheck.isMismatch) {
                namingWarningCount += 1;
                console.warn('❌ KO NAMING: variation.name ~= equivalentTo.name.join');
                if (!namingCheck.frMatches) {
                    console.warn(`   FR actuel: "${namingCheck.variationFr}"`);
                    console.warn(`   FR attendu (~join): "${namingCheck.joinedFr}"`);
                }
                if (!namingCheck.enMatches) {
                    console.warn(`   EN actuel: "${namingCheck.variationEn}"`);
                    console.warn(`   EN attendu (~join): "${namingCheck.joinedEn}"`);
                }
            }
            console.warn(`📌 equivalentTo ACTUEL: ${formatEquivalentList(equivalentDocs)}`);
            console.warn(`✅ ORDRE SUGGERE: ${formatEquivalentList(suggestedOrder)}`);
            if (checkNaming && namingCheckSuggested.isMismatch) {
                console.warn('⚠️ NOTE: le naming reste incoherent meme avec ordre suggere');
            }
        }

        console.log('\n📣 WARNINGS SUMMARY');
        console.log(`- TOTAL VARIATIONS EN WARNING: ${warningCount}`);
        console.log(`- KO ORDER: ${orderWarningCount}`);
        console.log(`- KO MULTI-EXERCISE: ${multiExerciseWarningCount}`);
        console.log(`- KO NAMING: ${checkNaming ? namingWarningCount : 'SKIPPED (--check-naming pour activer)'}`);
        console.log(`- ORDER FIX PLANNED: ${orderFixPlannedCount}`);
        console.log(`- ORDER FIX APPLIED: ${applyOrder ? orderFixAppliedCount : 'DRY-RUN (--apply-order pour appliquer)'}`);
        console.log('✅ DONE');
    } finally {
        await client.close();
    }
}

run().catch((error) => {
    console.error('checkEquivalentToExerciseOrder failed:', error.message);
    process.exitCode = 1;
});
