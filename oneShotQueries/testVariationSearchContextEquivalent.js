const mongoose = require('mongoose');
require('dotenv').config();

const variationLib = require('../lib/variation');
const setLib = require('../lib/set');
const Variation = require('../schema/variation');

const TEST_QUERY = {
    search: 'Élévations latérales haltères',
    page: 1,
    limit: 8,
    isExercice: true,
    sortBy: 'recommended',
    userId: '6365489f44d4b4000470882b',
    weightType: 'external_free',
    contextVariationId: '6922144b1c858345acc2d060'
};

function getPreferredName(doc) {
    if (!doc) return '(null)';
    return doc?.name?.fr || doc?.name?.en || String(doc?._id || '(no-id)');
}

async function run() {
    await mongoose.connect(process.env.mongoURL + process.env.DATABASE);

    try {
        const root = await Variation.findById(TEST_QUERY.contextVariationId, {
            _id: 1,
            name: 1,
            equivalentTo: 1
        }).lean();

        if (!root) {
            throw new Error(`contextVariationId introuvable: ${TEST_QUERY.contextVariationId}`);
        }

        const familySeedIds = setLib.resolveFamilySeedIds(String(root._id), root);
        const prefixes = setLib.buildVariationPrefixes(familySeedIds);
        const prefixDocs = await Promise.all(
            prefixes.map(async (prefixIds) => {
                const signature = setLib.getVariationSignature(prefixIds);
                const match = await Variation.findOne({
                    equivalentTo: {
                        $size: prefixIds.length,
                        $all: prefixIds.map((id) => new mongoose.Types.ObjectId(id))
                    },
                    isExercice: true
                }, { _id: 1, name: 1, equivalentTo: 1 }).lean();
                return { prefixIds, signature, match };
            })
        );

        const { variations, total } = await variationLib.getVariationBySearch(
            TEST_QUERY.search,
            undefined,
            TEST_QUERY.sortBy,
            TEST_QUERY.page,
            TEST_QUERY.limit,
            undefined,
            TEST_QUERY.isExercice,
            undefined,
            TEST_QUERY.userId,
            TEST_QUERY.weightType,
            undefined,
            undefined,
            TEST_QUERY.contextVariationId,
            undefined,
            undefined,
            undefined
        );

        console.log('\n=== INPUT ===');
        console.log(TEST_QUERY);

        console.log('\n=== CONTEXT ===');
        console.log(`context: ${root._id} -> ${getPreferredName(root)}`);
        console.log(`familySeedIds: ${JSON.stringify(familySeedIds)}`);

        console.log('\n=== PREFIX EXPECTED CANDIDATES ===');
        prefixDocs.forEach((entry, idx) => {
            const matchId = entry.match?._id ? String(entry.match._id) : '(none)';
            const matchName = getPreferredName(entry.match);
            console.log(
                `${idx + 1}. prefix=${JSON.stringify(entry.prefixIds)} sig=${entry.signature} => ${matchId} | ${matchName}`
            );
        });

        console.log('\n=== SEARCH RESULTS ===');
        console.log(`total=${total}, returned=${variations.length}`);
        variations.forEach((doc, idx) => {
            console.log(`${idx + 1}. ${String(doc._id)} | ${getPreferredName(doc)}`);
        });

        const expectedIds = new Set([
            String(root._id),
            ...prefixDocs.filter((p) => p.match?._id).map((p) => String(p.match._id))
        ]);
        const resultIds = new Set(variations.map((v) => String(v._id)));

        const missing = [...expectedIds].filter((id) => !resultIds.has(id));
        const foundInOrder = variations
            .map((doc, index) => ({ id: String(doc._id), index }))
            .filter((row) => expectedIds.has(row.id));

        console.log('\n=== DIAGNOSTIC ===');
        console.log(`expectedIds=${JSON.stringify([...expectedIds])}`);
        console.log(`foundExpectedInResults=${JSON.stringify(foundInOrder)}`);
        console.log(`missingExpected=${JSON.stringify(missing)}`);
    } finally {
        await mongoose.connection.close();
    }
}

run().catch((error) => {
    console.error('Erreur testVariationSearchContextEquivalent:', error);
    process.exitCode = 1;
});
