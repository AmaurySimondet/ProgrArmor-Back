const mongoose = require('mongoose');
const Seance = require('../schema/seance'); // Adjust the path as needed
const Seanceset = require('../schema/seanceset');
const AwsImage = require('../schema/awsImage');
const SeanceComment = require('../schema/seanceComment');
const Reaction = require('../schema/reaction');
const Notification = require('../schema/notification');
const Variation = require('../schema/variation');
const { secondsToEquivalentReps } = require('../utils/oneRepMax');
require('dotenv').config();

/**
 * Fetches the last seance of a user based on the seance date or createdAt with optional seance name filtering.
 * @param {string} userId - The ID of the user.
 * @param {string} field - The field to sort by ('date' or 'createdAt').
 * @param {string} [seanceName] - Optional seance name to filter.
 * @returns {Promise<Object>} - A promise that resolves to the last seance object.
 */
async function getLastSeance(userId, field, seanceName) {
    try {
        const query = { user: new mongoose.Types.ObjectId(userId) };
        if (seanceName) {
            query.name = seanceName;
        }
        if (!field) {
            field = 'date';
        }

        const lastSeance = await Seance.findOne(query)
            .sort({ [field]: -1 })
            .exec();

        return lastSeance;
    } catch (err) {
        console.error("Error fetching last seance:", err);
        throw err;
    }
}

/**
 * Fetches all unique seance names for a user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<Array<string>>} - A promise that resolves to an array of unique seance names.
 */
async function getSeanceNames(userId) {
    try {
        const seances = await Seance.find({ user: new mongoose.Types.ObjectId(userId) }, ["name", "date", "title", "description", "_id", "seancePhotos"]).sort({ date: -1 }).exec();
        return seances;
    } catch (err) {
        console.error("Error fetching seance names:", err);
        throw err;
    }
}


/**
 * Get a seance by id
 * @param {string} id - The ID of the seance.
 * @returns {Promise<Object>} - A promise that resolves to the seance object.
 */
async function getSeance(id) {
    try {
        const seance = await Seance.findById(id).exec();
        return seance;
    } catch (err) {
        console.error("Error fetching seance:", err);
        throw err;
    }
}


/**
 * Fetches all seances.
 * @param {list} users - The list of user IDs to fetch seances from.
 * @param {number} page - The page number.
 * @param {number} limit - The number of seances per page.
 * @param {string} seanceName - The name of the seance to filter by.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of seance objects.
 * @throws {Error} - If an error occurs while fetching seances.
*/
async function getSeances(users, page = 1, limit = 3, seanceName) {
    try {
        const skip = (page - 1) * limit;

        let query = {};
        if (users) {
            query = { user: { $in: users.map(id => new mongoose.Types.ObjectId(id)) } }
        }
        if (seanceName) {
            query.name = seanceName;
        }

        const [result] = await Seance.aggregate([
            { $match: query },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    seances: [
                        { $sort: { date: -1, _id: -1 } },
                        { $skip: skip },
                        { $limit: limit },
                    ]
                }
            }
        ]).exec();

        const total = result.total[0]?.count || 0;

        return {
            seances: result.seances,
            hasMore: total > skip + limit,
            total
        };
    } catch (err) {
        console.error("Error fetching seances:", err);
        throw err;
    }
}


/**
 * Create a new seance.
 * @param {Object} seanceData - The seance data.
 * @param {Array<string>} photoIds - The IDs of the photos to associate with the seance.
 * @returns {Promise<Object>} - A promise that resolves to the newly created seance object.
 */
async function createSeance(seanceData, photoIds, authenticatedUserId) {
    try {
        if (!authenticatedUserId) {
            throw new Error("Unauthorized");
        }
        Seance.init();
        const payload = { ...seanceData, user: authenticatedUserId };
        const newSeance = new Seance(payload);
        await newSeance.save();

        if (photoIds) {
            await AwsImage.updateMany(
                { _id: { $in: photoIds } },
                { $set: { seanceId: newSeance._id, seanceName: null, seanceDate: null } }
            );

            const seanceImages = await AwsImage.find({ _id: { $in: photoIds.map(id => new mongoose.Types.ObjectId(id)) } });
            const seancePhotos = seanceImages.map(image => image.cloudfrontUrl);

            await Seance.findByIdAndUpdate(
                newSeance._id,
                { seancePhotos: seancePhotos }
            );
        }

        return newSeance;
    } catch (err) {
        console.error("Error creating seance:", err);
        throw err;
    }
}

/**
 * Delete a seance by id, also deletes sets, photos, comments, reactions and notifications associated with the seance
 * @param {string} id - The ID of the seance.
 * @param {string} user - The ID of the user.
 * @returns {Promise<void>} - A promise that resolves when the seance and all associated entities are deleted.
 */
async function deleteSeance(id, user) {
    try {
        if (!user) {
            throw new Error("User ID is required");
        }
        if (!id) {
            throw new Error("Seance ID is required");
        }
        const seanceComments = await SeanceComment.find({ seance: id }, { _id: 1 }).lean();
        const commentIds = seanceComments.map((comment) => comment._id);

        const deletedSeance = await Seance.findOneAndDelete({ _id: id, user });
        if (!deletedSeance) {
            throw new Error("Seance not found or forbidden");
        }
        await Seanceset.deleteMany({ seance: id });
        await AwsImage.deleteMany({ seanceId: id });
        await Reaction.deleteMany({ seance: id });
        await SeanceComment.deleteMany({ seance: id });

        const notificationQuery = commentIds.length > 0
            ? { $or: [{ seance: id }, { comment: { $in: commentIds } }] }
            : { seance: id };
        await Notification.deleteMany(notificationQuery);
    } catch (err) {
        console.error("Error deleting seance:", err);
        throw err;
    }
}

/**
 * Update a seance
 * @param {string} id - The ID of the seance.
 * @param {Object} seanceData - The seance data.
 * @param {Array<string>} photoIds - The IDs of the photos to associate with the seance.
 * @returns {Promise<Object>} - A promise that resolves to the updated seance object.
 */
async function updateSeance(id, seanceData, photoIds, authenticatedUserId) {
    try {
        if (!authenticatedUserId) {
            throw new Error("Unauthorized");
        }
        // Extract _id from seanceData if present to avoid casting errors
        const { _id, ...updateData } = seanceData;
        delete updateData.user;

        if (photoIds) {
            await AwsImage.updateMany(
                { _id: { $in: photoIds } },
                { $set: { seanceId: id, seanceName: null, seanceDate: null } }
            );

            const seanceImages = await AwsImage.find({ _id: { $in: photoIds.map(id => new mongoose.Types.ObjectId(id)) } });
            const seancePhotos = seanceImages.map(image => image.cloudfrontUrl);
            updateData.seancePhotos = seancePhotos;
        }

        const updatedSeance = await Seance.findOneAndUpdate(
            { _id: id, user: authenticatedUserId },
            updateData,
            { new: true }
        );
        if (!updatedSeance) {
            throw new Error("Seance not found or forbidden");
        }
        return updatedSeance;
    } catch (err) {
        console.error("Error updating seance:", err);
        throw err;
    }
}

const MUSCLE_LABELS = {
    chest: { fr: 'Pecs', en: 'Chest' },
    upper_back: { fr: 'Haut du dos', en: 'Upper back' },
    lats: { fr: 'Dos', en: 'Lats' },
    traps: { fr: 'Trapèzes', en: 'Traps' },
    neck: { fr: 'Cou', en: 'Neck' },
    deltoids_front: { fr: 'Épaules avant', en: 'Front delts' },
    deltoids_side: { fr: 'Épaules', en: 'Side delts' },
    deltoids_rear: { fr: 'Épaules arrière', en: 'Rear delts' },
    biceps: { fr: 'Biceps', en: 'Biceps' },
    triceps: { fr: 'Triceps', en: 'Triceps' },
    forearms: { fr: 'Avant-bras', en: 'Forearms' },
    abs: { fr: 'Abdos', en: 'Abs' },
    obliques: { fr: 'Obliques', en: 'Obliques' },
    spinal_erectors: { fr: 'Lombaires', en: 'Spinal erectors' },
    glutes: { fr: 'Fessiers', en: 'Glutes' },
    hamstrings: { fr: 'Ischios', en: 'Hamstrings' },
    quads: { fr: 'Quadriceps', en: 'Quads' },
    adductors: { fr: 'Adducteurs', en: 'Adductors' },
    abductors: { fr: 'Abducteurs', en: 'Abductors' },
    calves: { fr: 'Mollets', en: 'Calves' },
};

function normalizeSeanceNamePayload(payload = {}) {
    const language = payload.language === 'en' ? 'en' : 'fr';
    const variationIdSet = new Set();

    if (Array.isArray(payload.variationIds)) {
        for (const id of payload.variationIds) {
            if (id) variationIdSet.add(String(id));
        }
    }

    if (Array.isArray(payload.sets)) {
        for (const set of payload.sets) {
            if (!set || !Array.isArray(set.variations)) continue;
            for (const v of set.variations) {
                if (v && v.variation) {
                    variationIdSet.add(String(v.variation));
                }
            }
        }
    }

    return {
        language,
        variationIds: Array.from(variationIdSet),
        sets: Array.isArray(payload.sets) ? payload.sets : [],
    };
}

async function loadVariationsForIds(variationIds) {
    if (!variationIds.length) return [];

    return Variation.find(
        { _id: { $in: variationIds.map(id => new mongoose.Types.ObjectId(id)) } },
        ['name', 'muscles', 'weightType']
    ).lean();
}

function computePatternLabelFromVariations(variations, language) {
    if (!variations.length) return null;

    const muscleScores = {};
    let totalScore = 0;

    for (const v of variations) {
        const m = v.muscles || {};

        if (Array.isArray(m.primary)) {
            for (const code of m.primary) {
                if (!code) continue;
                muscleScores[code] = (muscleScores[code] || 0) + 2;
                totalScore += 2;
            }
        }
        if (Array.isArray(m.secondary)) {
            for (const code of m.secondary) {
                if (!code) continue;
                muscleScores[code] = (muscleScores[code] || 0) + 1;
                totalScore += 1;
            }
        }
    }

    const sortedMuscles = Object.entries(muscleScores)
        .sort((a, b) => b[1] - a[1]);

    const upperMuscles = new Set([
        'chest', 'upper_back', 'lats', 'traps', 'neck',
        'deltoids_front', 'deltoids_side', 'deltoids_rear',
        'biceps', 'triceps', 'forearms', 'abs', 'obliques',
    ]);
    const lowerMuscles = new Set([
        'spinal_erectors', 'glutes', 'hamstrings', 'quads',
        'adductors', 'abductors', 'calves',
    ]);

    let upperScore = 0;
    let lowerScore = 0;
    for (const [code, score] of Object.entries(muscleScores)) {
        if (upperMuscles.has(code)) upperScore += score;
        if (lowerMuscles.has(code)) lowerScore += score;
    }

    const pct = (x) => (totalScore > 0 ? x / totalScore : 0);
    const upperPct = pct(upperScore);
    const lowerPct = pct(lowerScore);

    const getMuscleLabel = (code) => {
        const entry = MUSCLE_LABELS[code];
        if (!entry) return null;
        return entry[language] || entry.fr || entry.en;
    };

    let patternLabel;

    if (variations.length === 1) {
        const v = variations[0];
        const nameObj = v.name || {};
        patternLabel = nameObj[language] || nameObj.fr || nameObj.en;
    }

    if (!patternLabel && sortedMuscles.length === 1) {
        const [code] = sortedMuscles[0];
        patternLabel = getMuscleLabel(code);
    }

    // Cas 3: si haut et bas significatifs -> Full body directement
    if (!patternLabel && totalScore > 0) {
        if (upperPct >= 0.3 && lowerPct >= 0.3) {
            patternLabel = language === 'en' ? 'Full body' : 'Full Body';
        }
    }

    // Cas 4: patterns plus spécifiques (Dos/Biceps, Épaules, Push, Pull, Legs...)
    if (!patternLabel && totalScore > 0) {
        const chestScore = muscleScores.chest || 0;
        const tricepsScore = muscleScores.triceps || 0;
        const bicepsScore = muscleScores.biceps || 0;
        const deltsScore =
            (muscleScores.deltoids_front || 0) +
            (muscleScores.deltoids_side || 0) +
            (muscleScores.deltoids_rear || 0);
        const backScore =
            (muscleScores.lats || 0) +
            (muscleScores.upper_back || 0) +
            (muscleScores.traps || 0);

        const chestPct = pct(chestScore);
        const tricepsPct = pct(tricepsScore);
        const bicepsPct = pct(bicepsScore);
        const deltsPct = pct(deltsScore);
        const backPct = pct(backScore);

        if (!patternLabel &&
            backPct >= 0.35 &&
            bicepsPct >= 0.15 &&
            chestPct < 0.2 &&
            tricepsPct < 0.2 &&
            lowerPct < 0.2) {
            patternLabel = language === 'en' ? 'Back/Biceps' : 'Dos/Biceps';
        }

        if (!patternLabel && deltsPct >= 0.4 && lowerPct < 0.2) {
            patternLabel = language === 'en' ? 'Shoulders' : 'Épaules';
        }

        const pushScore = chestScore + tricepsScore + (muscleScores.deltoids_front || 0);
        const pushPct = pct(pushScore);
        if (!patternLabel &&
            pushPct >= 0.4 &&
            backPct < 0.25 &&
            lowerPct < 0.2) {
            patternLabel = language === 'en' ? 'Push' : 'Push';
        }

        const pullScore = backScore + bicepsScore;
        const pullPct = pct(pullScore);
        if (!patternLabel &&
            pullPct >= 0.4 &&
            chestPct < 0.25 &&
            tricepsPct < 0.25 &&
            lowerPct < 0.2) {
            patternLabel = language === 'en' ? 'Pull' : 'Pull';
        }

        if (!patternLabel &&
            (chestScore + tricepsScore) / (totalScore || 1) >= 0.6 &&
            backPct < 0.25 &&
            bicepsPct < 0.25 &&
            lowerPct < 0.2) {
            patternLabel = language === 'en' ? 'Chest/Triceps' : 'Pecs/Triceps';
        }
    }

    // Cas 5: grands patterns haut / bas / full (si pas déjà tranché)
    if (!patternLabel && totalScore > 0) {
        if (upperPct >= 0.7 && lowerPct < 0.3) {
            patternLabel = language === 'en' ? 'Upper body' : 'Haut du corps';
        } else if (lowerPct >= 0.7 && upperPct < 0.3) {
            patternLabel = language === 'en' ? 'Legs' : 'Bas du corps';
        } else if (upperPct >= 0.3 && lowerPct >= 0.3) {
            patternLabel = language === 'en' ? 'Full body' : 'Full Body';
        }
    }

    if (!patternLabel) {
        patternLabel = language === 'en' ? 'Session' : 'Séance';
    }

    return patternLabel;
}

function computeLoadTypeLabelFromVariations(variations, language) {
    const weightTypeCounts = {};
    for (const v of variations) {
        if (!v.weightType) continue;
        weightTypeCounts[v.weightType] = (weightTypeCounts[v.weightType] || 0) + 1;
    }

    const totalWeightTypes = Object.values(weightTypeCounts).reduce((a, b) => a + b, 0);
    if (!totalWeightTypes) return null;

    const entries = Object.entries(weightTypeCounts).sort((a, b) => b[1] - a[1]);
    const [dominantType, dominantCount] = entries[0];
    const dominantPct = dominantCount / totalWeightTypes;

    if (dominantPct < 0.7) return null;

    if (dominantType === 'bodyweight_plus_external') {
        return language === 'en' ? 'Bodyweight' : 'Poids du corps';
    }
    if (dominantType === 'external_free') {
        return language === 'en' ? 'Free weights' : 'Charges libres';
    }
    if (dominantType === 'external_machine') {
        return language === 'en' ? 'Machines' : 'Machine';
    }

    return null;
}

function computeIntensityLabelFromSets(sets, language) {
    if (!Array.isArray(sets) || sets.length === 0) return null;

    let sumRepsEq = 0;
    let countReps = 0;

    for (const set of sets) {
        if (!set) continue;
        const raw = typeof set.value === 'number' ? set.value : Number(set.value);
        if (!Number.isFinite(raw) || raw <= 0) continue;

        let repsEq = raw;
        if (set.unit === 'seconds') {
            repsEq = secondsToEquivalentReps(raw);
        }

        if (Number.isFinite(repsEq) && repsEq > 0) {
            sumRepsEq += repsEq;
            countReps += 1;
        }
    }

    if (!countReps) return null;

    const avgReps = sumRepsEq / countReps;
    if (avgReps <= 5) {
        return language === 'en' ? 'Strength' : 'Force';
    }
    if (avgReps >= 10) {
        return 'Volume';
    }

    return null;
}

/**
 * Suggest a seance name based on variations / sets.
 * @param {{ language?: 'fr'|'en', variationIds?: string[]|mongoose.Types.ObjectId[], sets?: Array<{ unit?: string, value?: number, variations?: Array<{ variation: string|mongoose.Types.ObjectId }> }> }} payload
 * @returns {Promise<{ suggestions: { format1: string, format2: string, format3: string, format4: string }, patternLabel: string, loadTypeLabel: string|null, intensityLabel: string|null }>}
 */
async function getSeanceNameSuggestion(payload = {}) {
    const { language, variationIds, sets } = normalizeSeanceNamePayload(payload);

    // Debug: entrée brute + normalisée
    try {
        console.log('[nameSuggestion] rawPayload', JSON.stringify(payload));
        console.log('[nameSuggestion] normalized', JSON.stringify({ language, variationIdsCount: variationIds.length, setsCount: Array.isArray(sets) ? sets.length : 0 }));
    } catch (e) {
        // ignore JSON stringify issues
    }

    if (!variationIds.length) {
        const fallbackLabel = language === 'en' ? 'Session' : 'Séance';
        const result = {
            suggestions: {
                format1: fallbackLabel,
                format2: fallbackLabel,
                format3: fallbackLabel,
                format4: fallbackLabel,
            },
            patternLabel: fallbackLabel,
            loadTypeLabel: null,
            intensityLabel: null,
        };
        console.log('[nameSuggestion] result (no variations)', result);
        return result;
    }

    const variations = await loadVariationsForIds(variationIds);

    if (!variations.length) {
        const fallbackLabel = language === 'en' ? 'Session' : 'Séance';
        const result = {
            suggestions: {
                format1: fallbackLabel,
                format2: fallbackLabel,
                format3: fallbackLabel,
                format4: fallbackLabel,
            },
            patternLabel: fallbackLabel,
            loadTypeLabel: null,
            intensityLabel: null,
        };
        console.log('[nameSuggestion] result (no variations found in DB)', result);
        return result;
    }

    try {
        console.log('[nameSuggestion] variations used', variations.map(v => ({
            id: String(v._id),
            name: v.name,
            muscles: v.muscles,
            weightType: v.weightType,
        })));
        console.log('[nameSuggestion] muscles details', variations.map(v => ({
            primary: v.muscles?.primary,
            secondary: v.muscles?.secondary,
        })));
    } catch (e) {
        // ignore
    }

    const patternLabel = computePatternLabelFromVariations(variations, language);
    const loadTypeLabel = computeLoadTypeLabelFromVariations(variations, language);
    const intensityLabel = computeIntensityLabelFromSets(sets, language);

    const format1 = patternLabel;
    const format2 = loadTypeLabel ? `${patternLabel} - ${loadTypeLabel}` : patternLabel;
    const format3 = intensityLabel ? `${patternLabel} - ${intensityLabel}` : patternLabel;

    let format4 = patternLabel;
    if (loadTypeLabel && intensityLabel) {
        format4 = `${patternLabel} - ${loadTypeLabel} - ${intensityLabel}`;
    } else if (loadTypeLabel) {
        format4 = `${patternLabel} - ${loadTypeLabel}`;
    } else if (intensityLabel) {
        format4 = `${patternLabel} - ${intensityLabel}`;
    }

    const result = {
        suggestions: {
            format1,
            format2,
            format3,
            format4,
        },
        patternLabel,
        loadTypeLabel,
        intensityLabel,
    };

    console.log('[nameSuggestion] result (final)', result);
    return result;
}

// Export the functions
module.exports = { getLastSeance, getSeanceNames, getSeance, getSeances, createSeance, deleteSeance, updateSeance, getSeanceNameSuggestion };

