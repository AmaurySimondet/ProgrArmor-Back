/**
 * Ajoute muscles.primary/secondary aux anciennes variations racines Adduction / Abduction.
 * Usage: node oneShotQueries/backfillLegacyAdductionAbductionMuscles.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Variation = require('../schema/variation');

const PATCHES = [
    {
        _id: '669c3609218324e0b7682b75',
        name: 'Adduction',
        muscles: { primary: ['adductors'], secondary: ['glutes'] },
    },
    {
        _id: '669c3609218324e0b7682b74',
        name: 'Abduction',
        muscles: { primary: ['abductors'], secondary: ['glutes'] },
    },
];

async function main() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE');
    }

    await mongoose.connect(mongoUrl + database);

    for (const patch of PATCHES) {
        const res = await Variation.updateOne(
            { _id: patch._id },
            { $set: { muscles: patch.muscles } },
        );
        console.log(`${patch.name} (${patch._id}) matched=${res.matchedCount} modified=${res.modifiedCount}`);
    }

    await mongoose.disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
