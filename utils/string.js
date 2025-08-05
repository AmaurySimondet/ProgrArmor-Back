const nlp = require('compromise')
const { fra, eng } = require('stopword')
const axios = require('axios');
const Embedding = require('../schema/embedding');

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

    let text = normalizeString(input);

    // Tokenisation avec compromise
    const doc = nlp(text)
    const terms = doc.terms().out('array')

    console.log("terms", terms);

    // Retrait des stopwords + filtres simples
    // const tokens = terms.filter(token =>
    //     token.length > 2 &&
    //     !fra.includes(token) &&
    //      !eng.includes(token) &&
    //     /^[a-z]+$/.test(token)
    // )

    // return tokens
    return terms
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
 * Get embedding from database
 * @param {string} text - Text to search for
 * @returns {Promise<Object|null>} - Embedding document or null if not found
 */
async function getEmbeddingFromDb(text) {
    if (!text || typeof text !== 'string') {
        return { embedding: null, doc: null };
    }

    try {
        const normalizedText = normalizeString(text);
        const embeddingDoc = await Embedding.findOne({
            search: normalizedText,
        });

        if (embeddingDoc && embeddingDoc.embedding) {
            // Update usage statistics
            await Embedding.updateOne(
                { _id: embeddingDoc._id },
                {
                    $inc: { usageCount: 1 },
                    lastUsed: new Date()
                }
            );
            return embeddingDoc;
        }

        return null
    } catch (error) {
        console.error('Error getting embedding from DB:', error.message);
        return null
    }
}

/**
 * Generate embedding using Hugging Face API
 * @param {string} text - Text to encode
 * @returns {Promise<number[]|null>} - Embedding vector or null on error
 */
async function getEmbeddingFromHf(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }

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
            timeout: 3000
        });
        return response.data;
    } catch (error) {
        console.error('Error generating embedding from Hugging Face:', error.message);
        return null;
    }
}

/**
 * Get or create embedding with caching
 * @param {string} text - Text to encode
 * @returns {Promise<number[]|null>} - Embedding vector or null on error
 */
async function generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }

    const normalizedText = normalizeString(text);

    try {
        // First, try to get from database
        const doc = await getEmbeddingFromDb(normalizedText);

        if (!doc) {
            const embedding = await getEmbeddingFromHf(normalizedText);
            const newEmbedding = new Embedding({
                search: normalizedText,
                embedding: embedding
            });
            await newEmbedding.save();
            console.log(`Embedding created for: "${normalizedText}"`);
            return embedding;
        }

        console.log(`Embedding found in mongo for: "${normalizedText}"`);
        return doc?.embedding;
    } catch (error) {
        console.error('Error in generateEmbedding:', error.message);
        return null;
    }
}

/**
 * Génère différentes combinaisons de tokens pour optimiser la recherche
 * @param {string} input - Texte d'entrée
 * @returns {Array} - Array d'array d'objets avec tokens et leur score potentiel
 */
function generateTokenCombinations(input) {
    const validTokens = extractTokens(input);

    if (validTokens.length === 0) return [];

    const combinations = [];
    const seenCombinations = new Set();

    // Fonction pour ajouter une combinaison unique
    function addUniqueCombination(combo) {
        const comboKey = combo.join('|');
        if (!seenCombinations.has(comboKey)) {
            seenCombinations.add(comboKey);
            combinations.push(combo);
        }
    }

    // Fonction récursive pour générer toutes les combinaisons possibles
    function generateCombinations(tokens, currentCombo = []) {
        if (tokens.length === 0) {
            if (currentCombo.length > 0) {
                addUniqueCombination([...currentCombo]);
            }
            return;
        }

        // Essayer toutes les tailles possibles de groupes à partir du début
        for (let groupSize = 1; groupSize <= tokens.length; groupSize++) {
            const group = tokens.slice(0, groupSize).join(' ');
            const remainingTokens = tokens.slice(groupSize);

            generateCombinations(remainingTokens, [...currentCombo, group]);
        }
    }

    // Générer toutes les combinaisons possibles
    generateCombinations(validTokens);

    return combinations;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vectorA - First vector
 * @param {number[]} vectorB - Second vector
 * @returns {number} - Cosine similarity score between 0 and 1
 */
function cosineSimilarity(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (normA * normB);
}

/**
 * Calculate vector similarity between two strings using embeddings
 * @param {string} textA - First text
 * @param {string} textB - Second text
 * @returns {Promise<number>} - Similarity score between 0 and 1
 */
async function vectorSimilarity(textA, textB) {
    if (!textA || !textB) {
        return 0;
    }

    try {
        const [embeddingA, embeddingB] = await Promise.all([
            generateEmbedding(textA),
            generateEmbedding(textB)
        ]);

        if (!embeddingA || !embeddingB) {
            return 0;
        }

        return cosineSimilarity(embeddingA, embeddingB);
    } catch (error) {
        console.error('Error calculating vector similarity:', error.message);
        return 0;
    }
}

module.exports = {
    normalizeString,
    extractTokens,
    generateTokenCombinations,
    generateEmbedding,
    getEmbeddingFromDb,
    getEmbeddingFromHf,
    cosineSimilarity,
    vectorSimilarity
};