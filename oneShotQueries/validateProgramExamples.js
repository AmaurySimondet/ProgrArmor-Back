/**
 * Valide que tous les exercices des programmes exemples résolvent une variation.
 *
 * Usage: node oneShotQueries/validateProgramExamples.js
 * Requiert MongoDB + index Atlas Search « variations » (comme l’app en prod).
 */
const mongoose = require('mongoose');
require('dotenv').config();

const {
    PROGRAM_EXAMPLES,
    getProgramExamples,
    getExerciseCount,
    clearResolvedProgramCache,
} = require('../lib/programExamples');

function getMongoConnectionString() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (mongoUrl && database) {
        return `${mongoUrl}${database}`;
    }
    return process.env.MONGODB_URI || process.env.MONGO_URI || null;
}

async function main() {
    const uri = getMongoConnectionString();
    if (!uri) {
        console.error('mongoURL + DATABASE (ou MONGODB_URI) manquant dans .env');
        process.exit(1);
    }

    await mongoose.connect(uri);
    clearResolvedProgramCache();

    console.log(`Validation de ${PROGRAM_EXAMPLES.length} programmes exemples…\n`);

    let failed = false;

    try {
        const examples = await getProgramExamples();
        for (const example of examples) {
            const def = PROGRAM_EXAMPLES.find((d) => d.id === example.id);
            const expected = getExerciseCount(def);
            const actual = example.program?.length || 0;
            if (actual !== expected) {
                failed = true;
                console.error(`✗ ${example.id}: ${actual}/${expected} exercices résolus`);
            } else {
                console.log(`✓ ${example.id} (${example.name}): ${actual} exercices, 4×${12} reps`);
            }
        }
    } catch (err) {
        failed = true;
        console.error('Erreur:', err.message);
    } finally {
        await mongoose.disconnect();
    }

    if (failed) {
        process.exit(1);
    }
    console.log('\nTous les programmes exemples sont valides.');
}

main();
