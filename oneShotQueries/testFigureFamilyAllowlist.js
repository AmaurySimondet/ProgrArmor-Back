/**
 * Usage:
 *   node oneShotQueries/testFigureFamilyAllowlist.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');
const whichfigure = require('../lib/whichfigure');

const USER_ID = '6365489f44d4b4000470882b';
const WRIST = '6922144e1c858345acc2d16c';
const CURL = '6888d9706e86f456e1861e11';

async function runScenario({ label, lateralMode, familyKey = null }) {
    const familyPayload = await setLib.resolvePerformedFamilyTargets({
        userId: USER_ID,
        variations: [WRIST],
        familyKey,
        lateralMode,
    });
    const familyIds = (familyPayload.rows || []).map((row) => String(row.variationId));
    const valueResult = await whichfigure.computeRecommendedValueFigure({
        userId: USER_ID,
        mainExerciseId: CURL,
        referenceVariations: [WRIST],
        targetUnit: 'repetitions',
        effectiveWeightLoad: 12,
        lateralMode,
        familyKey,
        includeAllGraphTargets: true,
        maxTargets: 40,
    });
    const recIds = (valueResult.recommendations || []).map((entry) => String(entry.variationId));
    const extra = recIds.filter((id) => !familyIds.includes(id));
    console.log(`\n=== ${label} ===`);
    console.log('family rows:', familyPayload.rows.map((row) => row.name?.fr || row.variationId));
    console.log('recommendations:', (valueResult.recommendations || []).map((entry) => ({
        id: entry.variationId,
        name: entry?.name?.fr || entry?.name?.en || entry?.name,
        success: entry.success,
        value: entry.recommendedValue,
        historical: entry?.usedSets?.usedHistoricalSets,
    })));
    console.log('extra vs family (edges):', extra);
}

async function run() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }
    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    await runScenario({ label: 'bilateral', lateralMode: 'bilateral' });
    await runScenario({ label: 'left', lateralMode: 'left' });
}

run()
    .catch((err) => {
        console.error('Test failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
