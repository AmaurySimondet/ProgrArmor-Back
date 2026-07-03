/**
 * Tests unitaires — résolution d'image par combinaison de variations.
 * Usage: node lib/variationPicture.test.js
 *
 * Nécessite une connexion Mongo (MONGODB_URI ou config app).
 */
const assert = require('assert');
const mongoose = require('mongoose');
const {
    resolvePictureForVariationIds,
    resolvePictureFromLoggedVariationIds,
} = require('./variation');

const EXTENSION_LEAF_ID = '669c3609218324e0b7682b73';
const TRICEPS_ID = '669c3609218324e0b7682a44';
const HIGH_CABLE_ID = '669c3609218324e0b7682aad';
const ROPE_ID = '669c3609218324e0b7682ab1';
const LEG_EXTENSION_ID = '6922144b1c858345acc2d063';
const TRICEP_PUSHDOWN_ID = '6922144c1c858345acc2d079';
const LEG_EXTENSION_PICTURE = 'leg-extension';
const TRICEP_PUSHDOWN_PICTURE = 'tricep-pushdown';

function buildSignatureMap(entries) {
    const signatureMap = new Map(entries);
    let maxEquivLen = 1;
    for (const [, canon] of signatureMap.entries()) {
        maxEquivLen = Math.max(maxEquivLen, (canon.equivalentToIds || []).length);
    }
    return { signatureMap, maxEquivLen };
}

async function runUnitTests() {
    const { signatureMap, maxEquivLen } = buildSignatureMap([
        [
            `${EXTENSION_LEAF_ID}|${TRICEPS_ID}`,
            {
                picture: `https://example.com/${TRICEP_PUSHDOWN_PICTURE}.webp`,
                equivalentToIds: [EXTENSION_LEAF_ID, TRICEPS_ID],
            },
        ],
        [
            `${EXTENSION_LEAF_ID}|669c3609218324e0b7682a47`,
            {
                picture: `https://example.com/${LEG_EXTENSION_PICTURE}.webp`,
                equivalentToIds: [EXTENSION_LEAF_ID, '669c3609218324e0b7682a47'],
            },
        ],
    ]);

    const comboIds = [EXTENSION_LEAF_ID, TRICEPS_ID, HIGH_CABLE_ID, ROPE_ID];
    const resolved = resolvePictureFromLoggedVariationIds(comboIds, signatureMap, maxEquivLen);
    assert.ok(resolved, 'combo Extension+Triceps+Poulie haute+Corde doit résoudre une image');
    assert.ok(
        resolved.includes(TRICEP_PUSHDOWN_PICTURE),
        `attendu image triceps, reçu: ${resolved}`,
    );
    assert.ok(
        !resolved.includes(LEG_EXTENSION_PICTURE),
        'ne doit pas retourner extension jambe',
    );

    const empty = await resolvePictureForVariationIds([]);
    assert.strictEqual(empty.picture, null);
    assert.strictEqual(empty.source, null);

    console.log('variationPicture unit tests OK');
}

async function runIntegrationTests() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
        console.log('variationPicture integration tests skipped (no MONGODB_URI)');
        return;
    }

    await mongoose.connect(mongoUri);

    const comboIds = [EXTENSION_LEAF_ID, TRICEPS_ID, HIGH_CABLE_ID, ROPE_ID];
    const comboResult = await resolvePictureForVariationIds(comboIds);
    assert.ok(comboResult.picture, 'integration: combo doit résoudre une image');
    assert.ok(
        comboResult.picture.includes('tricep'),
        `integration: attendu triceps, reçu ${comboResult.picture}`,
    );
    assert.ok(
        !comboResult.picture.includes('leg-extension'),
        'integration: ne doit pas être extension jambe',
    );

    const embeddedResult = await resolvePictureForVariationIds([TRICEP_PUSHDOWN_ID]);
    assert.ok(embeddedResult.picture, 'integration: exercice vérifié doit avoir une image');
    assert.strictEqual(embeddedResult.source, 'embedded');

    await mongoose.disconnect();
    console.log('variationPicture integration tests OK');
}

(async () => {
    await runUnitTests();
    await runIntegrationTests();
})().catch((error) => {
    console.error('variationPicture tests failed:', error);
    process.exit(1);
});
