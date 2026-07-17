/**
 * Recalcule et écrase mergedAliases sur tous les seancesets
 * à partir des aliases actuels des variations référencées.
 *
 * Usage:
 *   node oneShotQueries/fillMergedAliasesInSeanceSets.js          # dry-run
 *   node oneShotQueries/fillMergedAliasesInSeanceSets.js --apply  # apply
 */
const mongoose = require('mongoose');
require('dotenv').config();

const BATCH_SIZE = 1000;
const APPLY = process.argv.includes('--apply');

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }
    return mongoUrl + database;
}

function normalizeAliasKey(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildMergedAliases(variationIds, aliasesByVariationId) {
    const merged = [];
    const seen = new Set();

    for (const variationId of variationIds) {
        const aliases = aliasesByVariationId.get(variationId) || [];
        for (const alias of aliases) {
            const raw = String(alias || '').trim();
            const key = normalizeAliasKey(raw);
            if (!raw || !key || seen.has(key)) continue;
            seen.add(key);
            merged.push(raw);
        }
    }

    return merged;
}

function mergedAliasesSignature(arr) {
    return (arr || [])
        .map((x) => normalizeAliasKey(x))
        .filter(Boolean)
        .sort()
        .join('|');
}

function extractVariationIds(doc) {
    if (!Array.isArray(doc?.variations)) return [];
    const ids = [];
    const seen = new Set();
    for (const entry of doc.variations) {
        const id = entry?.variation ? String(entry.variation) : null;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

async function run() {
    await mongoose.connect(getMongoUri());
    const db = mongoose.connection.db;
    console.log('Connected to database:', process.env.DATABASE);
    console.log('Mode:', APPLY ? 'APPLY' : 'dry-run');

    const variations = await db.collection('variations')
        .find({}, { projection: { aliases: 1 } })
        .toArray();

    const aliasesByVariationId = new Map(
        variations.map((doc) => [
            String(doc._id),
            Array.isArray(doc.aliases) ? doc.aliases : [],
        ]),
    );
    console.log(`Loaded ${variations.length} variations`);

    const cursor = db.collection('seancesets')
        .find({}, { projection: { _id: 1, variations: 1, mergedAliases: 1 } });

    let processed = 0;
    let changed = 0;
    let unchanged = 0;
    let empty = 0;
    const sampleChanges = [];
    let bulkOps = [];

    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        processed += 1;

        const variationIds = extractVariationIds(doc);
        const nextMergedAliases = buildMergedAliases(variationIds, aliasesByVariationId);
        const previous = Array.isArray(doc.mergedAliases) ? doc.mergedAliases : [];

        if (nextMergedAliases.length === 0) {
            empty += 1;
        }

        if (mergedAliasesSignature(previous) === mergedAliasesSignature(nextMergedAliases)) {
            unchanged += 1;
            continue;
        }

        changed += 1;
        if (sampleChanges.length < 10) {
            sampleChanges.push({
                _id: String(doc._id),
                variationCount: variationIds.length,
                oldCount: previous.length,
                newCount: nextMergedAliases.length,
                aliasesPreview: nextMergedAliases.slice(0, 12),
            });
        }

        bulkOps.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { mergedAliases: nextMergedAliases } },
            },
        });

        if (bulkOps.length >= BATCH_SIZE) {
            if (APPLY) {
                const res = await db.collection('seancesets').bulkWrite(bulkOps, { ordered: false });
                console.log(`Batch updated ${res.modifiedCount} documents`);
            }
            bulkOps = [];
        }
    }

    if (bulkOps.length > 0 && APPLY) {
        const res = await db.collection('seancesets').bulkWrite(bulkOps, { ordered: false });
        console.log(`Final batch updated ${res.modifiedCount} documents`);
    }

    console.log('\n=== Fill mergedAliases summary ===');
    console.log({
        applyMode: APPLY,
        processed,
        changed,
        unchanged,
        emptyMergedAliases: empty,
    });
    console.log('\nSample changed documents:', sampleChanges);

    if (!APPLY) {
        console.log('\nDry-run only. Use --apply to persist.');
    }
}

run()
    .catch(async (error) => {
        console.error('fillMergedAliasesInSeanceSets failed:', error);
        process.exitCode = 1;
        try { await mongoose.disconnect(); } catch (_) {}
    })
    .finally(async () => {
        try { await mongoose.disconnect(); } catch (_) {}
    });
