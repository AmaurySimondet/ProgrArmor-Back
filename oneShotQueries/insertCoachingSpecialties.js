const { MongoClient } = require('mongodb');
const translate = require('@vitalets/google-translate-api').translate;
require('dotenv').config();

const url = process.env.mongoURL;

const specialties = [
    "Musculation / Hypertrophie",
    "Remise en forme / Fitness général",
    "Street Workout / Calisthénics",
    "Powerlifting",
    "Perte de poids / Gestion du poids",
    "Endurance / Entraînement cardio",
    "High-Intensity Interval Training (HIIT)",
    "Entraînement fonctionnel",
    "CrossFit",
    "Entraînement en circuit",
    "Préparation physique pour athlètes",
    "Entraînement de force",
    "Coaching pour seniors",
    "Entraînement prénatal et postnatal",
    "Coaching pour enfants et adolescents",
    "Rééducation sportive / Réhabilitation",
    "Coaching en nutrition et diététique",
    "Coaching de performance sportive",
    "Entraînement de flexibilité et mobilité",
    "Yoga et Pilates",
    "Bootcamp et entraînement en groupe",
    "Coaching en arts martiaux / sports de combat",
    "Entraînement en résistance (TRX, kettlebell, etc.)",
    "Coaching mental et motivationnel",
    "Préparation physique spécifique à un sport"
];

const now = new Date();

async function translateText(text, to) {
    try {
        const result = await translate(text, { to });
        return result.text;
    } catch (error) {
        console.error('Translation error:', error);
        return text;
    }
}

function normalizeText(text) {
    return text.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

async function createSpecialtiesToInsert(specialties) {
    const specialtiesToInsert = [];

    for (const specialty of specialties) {
        const translatedName = await translateText(specialty, 'en');

        specialtiesToInsert.push({
            createdAt: now,
            updatedAt: now,
            name: {
                fr: specialty,
                en: translatedName
            },
            normalizedName: {
                fr: normalizeText(specialty),
                en: normalizeText(translatedName)
            },
            description: {
                fr: "",
                en: ""
            },
        });
    }

    return specialtiesToInsert;
}

async function insertSpecialties() {
    const client = await MongoClient.connect(url);
    try {
        const db = client.db(process.env.DATABASE.split('/')[1]);
        const specialtiesToInsert = await createSpecialtiesToInsert(specialties);
        const result = await db.collection('coachingspecialties').insertMany(specialtiesToInsert);
        console.log(`${result.insertedCount} specialties inserted`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

insertSpecialties(); 