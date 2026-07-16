const mongoose = require('mongoose');
const SeanceSet = require('../schema/seanceset.js');
const Seance = require('../schema/seance.js');
const Variation = require('../schema/variation.js');
const {
    buildReverseEquivalentMuscleMap,
    resolveMuscleKeysForSet,
    resolveMuscleKeysForVariation,
} = require('./muscleWork');

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

function aggregateMuscleRecencyFromSets(
    sets = [],
    variationById = new Map(),
    reverseEquivalentMap = new Map(),
    referenceDate = new Date(),
) {
    const muscleLastEntry = {};
    const sortedSets = [...sets].sort((left, right) => {
        const dateDelta = left.date.getTime() - right.date.getTime();
        if (dateDelta !== 0) return dateDelta;
        return (left.setOrder ?? 0) - (right.setOrder ?? 0);
    });

    for (const set of sortedSets) {
        if (!set?.date) continue;

        const muscleKeysForSet = new Set(
            resolveMuscleKeysForSet(set, variationById, reverseEquivalentMap),
        );

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

async function attachSeanceTitlesToMuscleRecency(muscles = {}) {
    const seanceIds = [...new Set(
        Object.values(muscles)
            .map((entry) => entry?.lastSeanceId)
            .filter(Boolean)
            .map((id) => String(id)),
    )];

    if (!seanceIds.length) return muscles;

    const seances = await Seance.find({ _id: { $in: seanceIds } })
        .select('title name')
        .lean();
    const titleById = new Map(
        seances.map((seance) => [String(seance._id), seance.title || seance.name || null]),
    );

    for (const entry of Object.values(muscles)) {
        if (!entry?.lastSeanceId) continue;
        entry.lastSeanceTitle = titleById.get(String(entry.lastSeanceId)) || null;
    }

    return muscles;
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
        .select('muscles isExercice equivalentTo name type')
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

    const payload = aggregateMuscleRecencyFromSets(
        sets,
        variationById,
        reverseEquivalentMap,
        referenceDate,
    );

    await attachSeanceTitlesToMuscleRecency(payload.muscles);

    return payload;
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
