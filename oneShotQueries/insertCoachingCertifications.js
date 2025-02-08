const { MongoClient } = require('mongodb');
const translate = require('@vitalets/google-translate-api').translate;
require('dotenv').config();

const url = process.env.mongoURL;

const certifications = [
    {
        name: "BPJEPS Activités de la Forme",
        type: "national",
        level: "intermediate",
        category: "general",
        description: "Formation professionnelle permettant d'exercer en tant que coach sportif ou animateur d'activités physiques."
    },
    {
        name: "BPJEPS Activités Gymniques",
        type: "national",
        level: "intermediate",
        category: "specialized",
        description: "Formation professionnelle spécialisée dans les activités gymniques."
    },
    {
        name: "BPJEPS APT (Activités Physiques pour Tous)",
        type: "national",
        level: "intermediate",
        category: "general",
        description: "Formation professionnelle polyvalente pour l'animation d'activités physiques variées."
    },
    {
        name: "DEJEPS",
        type: "national",
        level: "advanced",
        category: "general",
        description: "Diplôme de niveau supérieur destiné aux professionnels souhaitant évoluer vers des postes à responsabilités."
    },
    {
        name: "CQP Coach Sportif",
        type: "national",
        level: "basic",
        category: "general",
        description: "Certification délivrée par des organismes professionnels attestant d'un niveau de compétence pour exercer le coaching sportif."
    },
    {
        name: "Licence STAPS",
        type: "national",
        level: "advanced",
        category: "academic",
        description: "Formation universitaire en sciences et techniques des activités physiques et sportives."
    },
    {
        name: "Master STAPS",
        type: "national",
        level: "expert",
        category: "academic",
        description: "Formation universitaire supérieure spécialisée en sciences du sport."
    },
    {
        name: "NASM Personal Trainer",
        type: "international",
        level: "intermediate",
        category: "general",
        description: "Certification internationale reconnue pour les entraîneurs personnels."
    },
    {
        name: "ACE Personal Trainer",
        type: "international",
        level: "intermediate",
        category: "general",
        description: "Certification américaine pour les entraîneurs personnels."
    },
    {
        name: "ISSA Personal Trainer",
        type: "international",
        level: "intermediate",
        category: "general",
        description: "Certification internationale en sciences du sport et entraînement personnel."
    },
    {
        name: "NSCA-CPT",
        type: "international",
        level: "advanced",
        category: "specialized",
        description: "Certification spécialisée en force et conditionnement physique."
    },
    {
        name: "CrossFit Level 1 Trainer",
        type: "international",
        level: "basic",
        category: "specialized",
        description: "Formation axée sur les méthodes d'entraînement propres à CrossFit."
    }
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

async function createCertificationsToInsert(certifications) {
    const certificationsToInsert = [];

    for (const cert of certifications) {
        const translatedName = await translateText(cert.name, 'en');
        const translatedDescription = await translateText(cert.description, 'en');

        certificationsToInsert.push({
            createdAt: now,
            updatedAt: now,
            name: {
                fr: cert.name,
                en: translatedName
            },
            normalizedName: {
                fr: normalizeText(cert.name),
                en: normalizeText(translatedName)
            },
            description: {
                fr: cert.description,
                en: translatedDescription
            },
            type: cert.type,
            level: cert.level,
            category: cert.category,
            validityPeriod: 0
        });
    }

    return certificationsToInsert;
}

async function insertCertifications() {
    const client = await MongoClient.connect(url);
    try {
        const db = client.db(process.env.DATABASE.split('/')[1]);
        const certificationsToInsert = await createCertificationsToInsert(certifications);
        const result = await db.collection('coachingcertifications').insertMany(certificationsToInsert);
        console.log(`${result.insertedCount} certifications inserted`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
    }
}

insertCertifications(); 