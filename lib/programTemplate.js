/**
 * Build a light program template from seance sets (for UserProgram.program backfill / update).
 */

function stripSetForTemplate(set) {
    if (!set || typeof set.unit !== 'string' || !set.unit.trim()) return null;
    const value = Number(set.value);
    if (!Number.isFinite(value)) return null;

    const payload = {
        unit: set.unit,
        value,
    };
    if (Number.isFinite(Number(set.weightLoad))) payload.weightLoad = Number(set.weightLoad);
    if (set.elastic && (set.elastic.use || set.elastic.tension != null)) {
        const tension = Number(set.elastic.tension);
        payload.elastic = {
            use: set.elastic.use || null,
            tension: Number.isFinite(tension) ? tension : null,
        };
    }
    if (set.isUnilateral === true) {
        payload.isUnilateral = true;
        if (set.unilateralSide) payload.unilateralSide = set.unilateralSide;
    }
    return payload;
}

function buildProgramTemplateFromSeanceSets(seanceSets = []) {
    if (!Array.isArray(seanceSets) || seanceSets.length === 0) return [];

    const byExerciseOrder = new Map();
    seanceSets.forEach((setDoc) => {
        const order = Number(setDoc.exerciceOrder) || 1;
        if (!byExerciseOrder.has(order)) {
            byExerciseOrder.set(order, []);
        }
        byExerciseOrder.get(order).push(setDoc);
    });

    const sortedOrders = [...byExerciseOrder.keys()].sort((a, b) => a - b);
    return sortedOrders.map((order) => {
        const setsForExercise = byExerciseOrder.get(order) || [];
        const firstSet = setsForExercise[0] || {};
        const variations = Array.isArray(firstSet.variations) ? firstSet.variations : [];
        const variationIds = variations
            .map((v) => v?.variation)
            .filter(Boolean)
            .map((id) => String(id));

        const primaryVariation = variations[0];
        const variationName = primaryVariation?.name
            ? { fr: primaryVariation.name.fr || '', en: primaryVariation.name.en || '' }
            : { fr: '', en: '' };

        const mergedVariationsNames = firstSet.mergedVariationsNames
            ? {
                fr: firstSet.mergedVariationsNames.fr || '',
                en: firstSet.mergedVariationsNames.en || '',
            }
            : {
                fr: variations.map((v) => v?.name?.fr).filter(Boolean).join(', '),
                en: variations.map((v) => v?.name?.en).filter(Boolean).join(', '),
            };

        const sets = setsForExercise
            .sort((a, b) => (Number(a.setOrder) || 0) - (Number(b.setOrder) || 0))
            .map(stripSetForTemplate)
            .filter(Boolean);

        return {
            variationIds,
            variationName,
            mergedVariationsNames,
            sets,
        };
    });
}

function countDistinctExercisesInSets(seanceSets = []) {
    const orders = new Set(
        (seanceSets || []).map((s) => Number(s.exerciceOrder)).filter(Number.isFinite)
    );
    return orders.size;
}

module.exports = {
    stripSetForTemplate,
    buildProgramTemplateFromSeanceSets,
    countDistinctExercisesInSets,
};
