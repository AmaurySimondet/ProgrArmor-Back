/**
 * Outils de debug pour la récence musculaire.
 * Utilise lib/muscleWork.js (même logique que la vue séance).
 */
const {
    buildReverseEquivalentMuscleMap,
    extractMuscleKeysFromVariation,
    getMusclesFromVariationChain,
    getPrimaryExerciseVariationFromList,
    resolveMuscleKeysForSet,
    resolveVariationChainFromSet,
} = require('./muscleWork');

function groupSetsByVariationKey(sets = []) {
    const groups = new Map();
    for (const set of sets) {
        const key = (set.variations || [])
            .map((entry) => String(entry?.variation))
            .filter(Boolean)
            .sort()
            .join('-');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(set);
    }
    return groups;
}

function traceSetMuscleContribution(set, variationById, reverseEquivalentMap = new Map()) {
    const chain = resolveVariationChainFromSet(set, variationById).map((variation) => {
        const direct = extractMuscleKeysFromVariation(variation);
        const isPrimary = getPrimaryExerciseVariationFromList([variation])?._id === variation._id
            && variation?.isExercice === true;
        return {
            variationId: String(variation._id),
            name: variation.name?.fr || variation.name?.en || null,
            isExercice: variation.isExercice === true,
            muscles: variation.muscles || null,
            muscleKeys: isPrimary ? direct.all : [],
            source: isPrimary ? (direct.all.length > 0 ? 'primary' : 'primary-equivalentTo') : 'ignored-detail',
        };
    });

    const muscleKeys = resolveMuscleKeysForSet(set, variationById, reverseEquivalentMap);
    const primaryExercise = getPrimaryExerciseVariationFromList(
        resolveVariationChainFromSet(set, variationById),
    );

    return {
        setId: set._id ? String(set._id) : null,
        setOrder: set.setOrder ?? null,
        date: set.date,
        seanceId: set.seance ? String(set.seance) : null,
        mergedName: set.mergedVariationsNames?.fr || set.mergedVariationsNames?.en || null,
        primaryExercise: primaryExercise
            ? {
                id: String(primaryExercise._id),
                name: primaryExercise.name?.fr || primaryExercise.name?.en || null,
            }
            : null,
        chain,
        muscleKeys,
    };
}

function computeProfileStyleMusclesForSets(sets = [], variationById, reverseEquivalentMap = new Map()) {
    const muscles = new Set();
    const contributions = [];

    for (const set of sets) {
        const trace = traceSetMuscleContribution(set, variationById, reverseEquivalentMap);
        for (const key of trace.muscleKeys) muscles.add(key);
        if (trace.muscleKeys.length > 0) {
            contributions.push(trace);
        }
    }

    return { muscles: [...muscles].sort(), contributions };
}

function computeSessionStyleMusclesForSets(sets = [], variationById, reverseEquivalentMap = new Map()) {
    const primary = new Set();
    const secondary = new Set();
    const exerciseBreakdown = [];

    const groups = groupSetsByVariationKey(sets);
    for (const [variationKey, groupSets] of groups.entries()) {
        const firstSet = groupSets[0];
        const resolvedVariations = resolveVariationChainFromSet(firstSet, variationById);
        const primaryExercise = getPrimaryExerciseVariationFromList(resolvedVariations);
        const { primary: p, secondary: s } = extractMuscleKeysFromVariation(primaryExercise);

        for (const key of p) primary.add(key);
        for (const key of s) secondary.add(key);

        exerciseBreakdown.push({
            variationKey,
            setCount: groupSets.length,
            mergedName: firstSet.mergedVariationsNames?.fr || firstSet.mergedVariationsNames?.en || variationKey,
            primaryExercise: primaryExercise
                ? {
                    id: String(primaryExercise._id),
                    name: primaryExercise.name?.fr || primaryExercise.name?.en || null,
                    muscles: primaryExercise.muscles || null,
                }
                : null,
            primaryMuscles: [...p],
            secondaryMuscles: [...s],
            chainVariationIds: (firstSet.variations || []).map((entry) => String(entry?.variation)),
            chainVariations: resolvedVariations.map((variation) => ({
                id: String(variation._id),
                name: variation.name?.fr || variation.name?.en || null,
                isExercice: variation.isExercice === true,
                muscles: variation.muscles || null,
            })),
            resolvedMuscles: getMusclesFromVariationChain(resolvedVariations, reverseEquivalentMap),
        });
    }

    const all = new Set([...primary, ...secondary]);
    return {
        primary: [...primary].sort(),
        secondary: [...secondary].sort(),
        all: [...all].sort(),
        exerciseBreakdown,
    };
}

function findMusclesAttributedToSeance(muscleRecencyPayload, seanceId) {
    const targetId = String(seanceId);
    const muscles = muscleRecencyPayload?.muscles || {};
    return Object.entries(muscles)
        .filter(([, entry]) => String(entry?.lastSeanceId || '') === targetId)
        .map(([muscleKey, entry]) => ({ muscleKey, ...entry }))
        .sort((a, b) => a.muscleKey.localeCompare(b.muscleKey));
}

function compareSessionVsProfileMuscles(sessionMuscles, profileMuscles) {
    const sessionSet = new Set(sessionMuscles.all || sessionMuscles);
    const profileSet = new Set(profileMuscles || []);

    const onlyInProfile = [...profileSet].filter((key) => !sessionSet.has(key)).sort();
    const onlyInSession = [...sessionSet].filter((key) => !profileSet.has(key)).sort();
    const shared = [...sessionSet].filter((key) => profileSet.has(key)).sort();

    return { onlyInProfile, onlyInSession, shared };
}

function explainProfileOnlyMuscles(onlyInProfile, contributions = []) {
    const explanations = {};

    for (const muscleKey of onlyInProfile) {
        const sources = [];
        for (const contribution of contributions) {
            if (contribution.muscleKeys.includes(muscleKey)) {
                sources.push({
                    setId: contribution.setId,
                    setOrder: contribution.setOrder,
                    mergedName: contribution.mergedName,
                    primaryExercise: contribution.primaryExercise,
                    muscleKeys: contribution.muscleKeys,
                });
            }
        }
        explanations[muscleKey] = sources;
    }

    return explanations;
}

function buildSeanceMuscleComparisonReport({
    seanceId,
    seanceTitle,
    seanceDate,
    sets = [],
    variationById,
    reverseEquivalentMap = new Map(),
    muscleRecencyPayload,
}) {
    const sessionStyle = computeSessionStyleMusclesForSets(sets, variationById, reverseEquivalentMap);
    const profileStyle = computeProfileStyleMusclesForSets(sets, variationById, reverseEquivalentMap);
    const apiAttributed = findMusclesAttributedToSeance(muscleRecencyPayload, seanceId);
    const apiMuscleKeys = apiAttributed.map((entry) => entry.muscleKey);

    const sessionVsProfile = compareSessionVsProfileMuscles(sessionStyle, profileStyle.muscles);
    const profileOnlyExplanations = explainProfileOnlyMuscles(
        sessionVsProfile.onlyInProfile,
        profileStyle.contributions,
    );

    const apiVsProfile = compareSessionVsProfileMuscles(
        profileStyle.muscles,
        apiMuscleKeys,
    );

    return {
        seanceId: String(seanceId),
        seanceTitle: seanceTitle || null,
        seanceDate: seanceDate ? new Date(seanceDate).toISOString() : null,
        setCount: sets.length,
        sessionStyle,
        profileStyle: {
            muscles: profileStyle.muscles,
            contributionCount: profileStyle.contributions.length,
        },
        apiAttributed: {
            count: apiAttributed.length,
            muscles: apiAttributed,
        },
        comparison: {
            sessionVsProfile,
            profileOnlyExplanations,
            apiVsProfile,
        },
        profileStyleContributions: profileStyle.contributions,
    };
}

module.exports = {
    traceSetMuscleContribution,
    computeProfileStyleMusclesForSets,
    computeSessionStyleMusclesForSets,
    findMusclesAttributedToSeance,
    compareSessionVsProfileMuscles,
    explainProfileOnlyMuscles,
    buildSeanceMuscleComparisonReport,
    buildReverseEquivalentMuscleMap,
};
