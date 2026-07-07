const mongoose = require('mongoose');
const SeanceSet = require('../schema/seanceset.js');
const Variation = require('../schema/variation.js');

function toUtcDateOnlyMs(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function computeDaysSince(dateValue, referenceDate = new Date()) {
    const targetMs = toUtcDateOnlyMs(dateValue);
    const referenceMs = toUtcDateOnlyMs(referenceDate);
    if (targetMs === null || referenceMs === null) return null;
    return Math.round((referenceMs - targetMs) / 86400000);
}

function extractMuscleKeys(variation) {
    const muscles = variation?.muscles;
    if (!muscles) return [];
    return [
        ...(Array.isArray(muscles.primary) ? muscles.primary : []),
        ...(Array.isArray(muscles.secondary) ? muscles.secondary : []),
    ].filter(Boolean);
}

function buildReverseEquivalentMuscleMap(canonicalVariations = []) {
    const map = new Map();
    for (const canonical of canonicalVariations) {
        const muscleKeys = extractMuscleKeys(canonical);
        if (muscleKeys.length === 0) continue;
        for (const legacyId of canonical.equivalentTo || []) {
            const id = String(legacyId);
            if (!map.has(id)) {
                map.set(id, muscleKeys);
            }
        }
    }
    return map;
}

function resolveMuscleKeysForVariation(variation, reverseEquivalentMap = new Map()) {
    const directKeys = extractMuscleKeys(variation);
    if (directKeys.length > 0) return directKeys;
    if (!variation?._id) return [];
    return reverseEquivalentMap.get(String(variation._id)) || [];
}

function aggregateMuscleRecencyFromSets(
    sets = [],
    variationById = new Map(),
    reverseEquivalentMap = new Map(),
    referenceDate = new Date(),
) {
    const muscleLastEntry = {};

    for (const set of sets) {
        if (!set?.date) continue;
        const chain = (set.variations || [])
            .map((entry) => variationById.get(String(entry?.variation)))
            .filter(Boolean);

        const muscleKeysForSet = new Set();
        for (const variation of chain) {
            for (const muscleKey of resolveMuscleKeysForVariation(variation, reverseEquivalentMap)) {
                muscleKeysForSet.add(muscleKey);
            }
        }

        const setDateMs = set.date.getTime();
        const seanceId = set.seance ? String(set.seance) : null;

        for (const muscleKey of muscleKeysForSet) {
            const current = muscleLastEntry[muscleKey];
            if (!current || setDateMs > current.dateMs) {
                muscleLastEntry[muscleKey] = {
                    dateMs: setDateMs,
                    lastWorkedDate: set.date,
                    lastSeanceId: seanceId,
                };
                continue;
            }
            if (setDateMs === current.dateMs && seanceId) {
                current.lastSeanceId = seanceId;
            }
        }
    }

    const muscles = {};
    for (const [muscleKey, entry] of Object.entries(muscleLastEntry)) {
        muscles[muscleKey] = {
            lastWorkedDate: entry.lastWorkedDate.toISOString().slice(0, 10),
            daysSince: computeDaysSince(entry.lastWorkedDate, referenceDate),
            lastSeanceId: entry.lastSeanceId || null,
        };
    }

    return {
        muscles,
        computedAt: referenceDate.toISOString(),
    };
}

/** @deprecated Conservé pour les tests — préférer aggregateMuscleRecencyFromSets */
function aggregateMuscleRecencyFromVariations(variationLastDates = [], variations = [], referenceDate = new Date()) {
    const sets = variationLastDates.map((entry) => ({
        date: entry.lastDate,
        variations: [{ variation: entry._id }],
    }));
    const variationById = new Map(
        variations.map((variation) => [String(variation._id), variation]),
    );
    return aggregateMuscleRecencyFromSets(sets, variationById, new Map(), referenceDate);
}

async function computeUserMuscleRecency(userIdObj, referenceDate = new Date()) {
    const sets = await SeanceSet.find({ user: userIdObj })
        .select('date seance variations.variation')
        .lean();

    if (!sets.length) {
        return {
            muscles: {},
            computedAt: referenceDate.toISOString(),
        };
    }

    const variationIds = new Set();
    for (const set of sets) {
        for (const entry of set.variations || []) {
            if (entry?.variation) variationIds.add(String(entry.variation));
        }
    }

    const objectIds = [...variationIds].map((id) => new mongoose.Types.ObjectId(id));
    const variations = await Variation.find({ _id: { $in: objectIds } })
        .select('muscles isExercice equivalentTo name')
        .lean();

    const variationById = new Map(
        variations.map((variation) => [String(variation._id), variation]),
    );

    const canonicalWithMuscles = await Variation.find({
        isExercice: true,
        $or: [
            { 'muscles.primary.0': { $exists: true } },
            { 'muscles.secondary.0': { $exists: true } },
        ],
        equivalentTo: { $in: objectIds },
    })
        .select('muscles equivalentTo')
        .lean();

    const reverseEquivalentMap = buildReverseEquivalentMuscleMap(canonicalWithMuscles);

    return aggregateMuscleRecencyFromSets(
        sets,
        variationById,
        reverseEquivalentMap,
        referenceDate,
    );
}

async function userMuscleRecency(req, res) {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required',
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID format',
            });
        }

        const userIdObj = new mongoose.Types.ObjectId(userId);
        const payload = await computeUserMuscleRecency(userIdObj);

        return res.json({
            success: true,
            ...payload,
        });
    } catch (error) {
        console.error('Error fetching user muscle recency:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching user muscle recency',
        });
    }
}

module.exports = {
    userMuscleRecency,
    computeUserMuscleRecency,
    aggregateMuscleRecencyFromSets,
    aggregateMuscleRecencyFromVariations,
    buildReverseEquivalentMuscleMap,
    resolveMuscleKeysForVariation,
    computeDaysSince,
};
