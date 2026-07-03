const { getEffectiveLoadPreferringPersisted } = require('../utils/set');

function getSortedVariationIds(variationIds = []) {
    return variationIds.map((id) => id.toString()).sort();
}

function getVariationSignature(variationIds = []) {
    return getSortedVariationIds(variationIds).join('|');
}

function resolveVariationPopularityNumber(variation) {
    const popularity = variation?.popularity;
    if (popularity == null) return null;
    if (typeof popularity === 'number' && Number.isFinite(popularity)) return popularity;
    if (typeof popularity === 'object' && popularity.global != null) {
        const global = Number(popularity.global);
        return Number.isFinite(global) ? global : null;
    }
    return null;
}

function averagePopularityForVariations(variations = []) {
    const values = variations
        .map(resolveVariationPopularityNumber)
        .filter((value) => value !== null);
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolvePersonalRecordSortWeightLoadKg(prs) {
    if (!prs) return 0;

    const athLoads = [];
    if (prs.ATH?.repetitions) {
        const load = getEffectiveLoadPreferringPersisted(prs.ATH.repetitions);
        if (Number.isFinite(load)) athLoads.push(load);
    }
    if (prs.ATH?.seconds) {
        const load = getEffectiveLoadPreferringPersisted(prs.ATH.seconds);
        if (Number.isFinite(load)) athLoads.push(load);
    }
    if (athLoads.length > 0) return Math.max(...athLoads);

    if (prs.Best) {
        const load = getEffectiveLoadPreferringPersisted(prs.Best);
        return Number.isFinite(load) ? load : 0;
    }
    return 0;
}

function normalizeAndMergeExerciseGroups(groups = []) {
    const merged = new Map();

    for (const group of groups) {
        const ids = getSortedVariationIds(group._id);
        const signature = getVariationSignature(ids);
        const existing = merged.get(signature);

        if (!existing) {
            merged.set(signature, {
                ...group,
                _id: ids,
                count: Number(group.count) || 0,
            });
            continue;
        }

        existing.count += Number(group.count) || 0;

        const incomingIsVerified = group.variations?.length === 1 && group.variations[0]?.verified === true;
        const existingIsVerified = existing.variations?.length === 1 && existing.variations[0]?.verified === true;
        if (incomingIsVerified && !existingIsVerified) {
            existing._id = ids;
            existing.variations = group.variations;
        }
    }

    return Array.from(merged.values());
}

function sortExerciseGroupsByCountStable(groups = []) {
    return [...groups].sort((a, b) => {
        const countDiff = (b.count || 0) - (a.count || 0);
        if (countDiff !== 0) return countDiff;
        return getVariationSignature(a._id).localeCompare(getVariationSignature(b._id));
    });
}

function sortPersonalRecordSummaries(summaries = []) {
    return [...summaries].sort((a, b) => {
        const popA = averagePopularityForVariations(a.variations);
        const popB = averagePopularityForVariations(b.variations);
        if (popB !== popA) return popB - popA;

        const loadA = resolvePersonalRecordSortWeightLoadKg(a.prs);
        const loadB = resolvePersonalRecordSortWeightLoadKg(b.prs);
        if (loadB !== loadA) return loadB - loadA;

        const sigA = getVariationSignature(a.variationIds || []);
        const sigB = getVariationSignature(b.variationIds || []);
        return sigA.localeCompare(sigB);
    });
}

function getSetVariationSignature(set) {
    const variationIds = (set?.variations || []).map((entry) => entry?.variation ?? entry);
    return getVariationSignature(variationIds);
}

function indexSetsByVariationSignature(allSets = []) {
    const index = new Map();

    for (const set of allSets) {
        const signature = getSetVariationSignature(set);
        if (!index.has(signature)) {
            index.set(signature, []);
        }
        index.get(signature).push(set);
    }

    for (const sets of index.values()) {
        sets.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    return index;
}

function collectSetsMatchingVariationGroups(setsBySignature, variationGroups = []) {
    const matchingSets = [];
    const seenSetIds = new Set();

    for (const group of variationGroups) {
        const signature = getVariationSignature(group);
        for (const set of setsBySignature.get(signature) || []) {
            const setId = set?._id?.toString();
            if (!setId || seenSetIds.has(setId)) continue;
            seenSetIds.add(setId);
            matchingSets.push(set);
        }
    }

    matchingSets.sort((a, b) => new Date(a.date) - new Date(b.date));
    return matchingSets;
}

module.exports = {
    getSortedVariationIds,
    getVariationSignature,
    resolveVariationPopularityNumber,
    averagePopularityForVariations,
    resolvePersonalRecordSortWeightLoadKg,
    normalizeAndMergeExerciseGroups,
    sortExerciseGroupsByCountStable,
    sortPersonalRecordSummaries,
    getSetVariationSignature,
    indexSetsByVariationSignature,
    collectSetsMatchingVariationGroups,
};
