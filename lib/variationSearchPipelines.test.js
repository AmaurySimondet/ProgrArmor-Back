/**
 * Tests unitaires — variationSearchPipelines + tokenizeExact
 *
 * Validation manuelle post-reindex Atlas (dev puis prod) :
 * 1. node oneShotQueries/updateVariationsWithAliases.js --apply
 * 2. node oneShotQueries/fillMergedAliasesInSeanceSets.js --apply
 * 3. Redéployer index Atlas : variations (atlassearch_index.json) + default/seancesets (atlassearch_index_seancesets.json)
 * 4. node oneShotQueries/testVariationSearch.js
 * 5. node oneShotQueries/testGetMyExercices.js
 *
 * Usage: node lib/variationSearchPipelines.test.js
 */
const assert = require('assert');
const mongoose = require('mongoose');
const {
    ALIASES_TEXT_BOOST,
    ALIASES_AUTOCOMPLETE_BOOST,
    MUSCLE_PRIMARY_TEXT_BOOST,
    buildVariationSearchCompound,
    buildMyExercisesSearchCompound,
} = require('./variationSearchPipelines');
const { tokenizeExact, getSearchableTokens } = require('./variation');

function collectPaths(compound) {
    const paths = [];
    for (const clause of compound.should || []) {
        if (clause.autocomplete?.path) paths.push(clause.autocomplete.path);
        if (clause.text?.path) paths.push(clause.text.path);
    }
    return paths;
}

function collectBoosts(compound) {
    const boosts = [];
    for (const clause of compound.should || []) {
        const boost = clause.autocomplete?.score?.boost?.value
            ?? clause.text?.score?.boost?.value;
        if (boost !== undefined) boosts.push(boost);
    }
    return boosts;
}

const userId = new mongoose.Types.ObjectId('6365489f44d4b4000470882b');

const catalogCompound = buildVariationSearchCompound({
    search: 'bench press',
    type: undefined,
    verified: true,
    isExercice: true,
    muscle: undefined,
    weightType: undefined,
});

const catalogPaths = collectPaths(catalogCompound);
assert.ok(catalogPaths.includes('aliases'), 'catalog search should query aliases');
assert.ok(catalogPaths.includes('muscles.primary'), 'catalog search should query muscles.primary');
assert.strictEqual(catalogPaths.filter((p) => p === 'aliases').length, 2);
assert.ok(!catalogPaths.some((p) => p.startsWith('name.')), 'catalog search should not query name.*');

const catalogBoosts = collectBoosts(catalogCompound);
assert.ok(catalogBoosts.includes(ALIASES_TEXT_BOOST));
assert.ok(catalogBoosts.includes(ALIASES_AUTOCOMPLETE_BOOST));
assert.ok(catalogBoosts.includes(MUSCLE_PRIMARY_TEXT_BOOST));
assert.strictEqual(ALIASES_TEXT_BOOST, 7);
assert.strictEqual(ALIASES_AUTOCOMPLETE_BOOST, 2);
assert.strictEqual(MUSCLE_PRIMARY_TEXT_BOOST, 3);

const myCompound = buildMyExercisesSearchCompound({
    search: 'dc',
    userId,
});
const myPaths = collectPaths(myCompound);
assert.deepStrictEqual(myPaths, ['mergedAliases', 'mergedAliases']);
assert.ok(!myPaths.some((p) => p.startsWith('mergedVariationsNames')), 'my exercises should not query mergedVariationsNames');
assert.ok(myCompound.filter?.some((f) => f.equals?.path === 'user'));

const muscleFiltered = buildVariationSearchCompound({
    search: 'quads',
    muscle: 'quads',
    isExercice: true,
});
assert.ok(muscleFiltered.filter?.length >= 1);

assert.deepStrictEqual(tokenizeExact('dc'), ['dc']);
assert.deepStrictEqual(tokenizeExact('bench press'), ['bench', 'press']);

const searchable = getSearchableTokens({
    name: { fr: 'Développé couché', en: 'Bench Press' },
    aliases: ['DC', 'Bench'],
});
assert.ok(searchable.has('dc'));
assert.ok(searchable.has('bench'));
assert.ok(searchable.has('developpe'));
assert.ok(searchable.has('couché') || searchable.has('couche'));

console.log('variationSearchPipelines.test.js: all tests passed');
