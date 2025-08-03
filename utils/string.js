const nlp = require('compromise')
const { fra, eng } = require('stopword')
const axios = require('axios');

/**
 * Extrait les tokens pertinents d'une requête utilisateur.
 * - Supprime les stopwords (FR/EN)
 * - Ignore les tokens courts ou non alpha
 * - Ne gère PAS les synonymes (gérés côté Mongo)
 * @param {string} input
 * @returns {string[]} Liste de tokens nettoyés
 */
function extractTokens(input) {
    if (!input || typeof input !== 'string') return []

    // Normalisation basique
    let text = input
        .toLowerCase()
        .normalize('NFD')                     // Décomposition accents
        .replace(/[\u0300-\u036f]/g, '')     // Suppression des accents
        .replace(/[^\w\s]/g, '')             // Suppression ponctuation

    // Tokenisation avec compromise
    const doc = nlp(text)
    const terms = doc.terms().out('array')

    // Retrait des stopwords + filtres simples
    const tokens = terms.filter(token =>
        token.length > 2 &&
        !fra.includes(token) &&
        !eng.includes(token) &&
        /^[a-z]+$/.test(token)
    )

    return tokens
}

function normalizeString(str) {
    return str
        .toLowerCase()
        // Remove accents/diacritics
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // Remove special characters
        .replace(/[^a-z0-9\s]/g, '')
        // Replace multiple spaces with single space
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Generate embedding using Hugging Face API
 * @param {string} text - Text to encode
 * @returns {Promise<number[]|null>} - Embedding vector or null on error
 */
async function generateEmbedding(text) {
    const apiUrl = 'https://api-inference.huggingface.co/models/intfloat/multilingual-e5-large';
    const payload = {
        inputs: `query: ${text}`,
        options: { wait_for_model: true }
    };
    const headers = {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await axios.post(apiUrl, payload, {
            headers,
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        console.error('Error generating embedding:', error.message);
        return null;
    }
}

module.exports = {
    normalizeString,
    extractTokens,
    generateEmbedding
};