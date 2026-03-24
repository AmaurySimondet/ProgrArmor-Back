/**
 * Converts elastic settings to a load delta.
 * resistance => +tension, assistance => -tension, otherwise 0.
 * @param {Object|null} elastic
 * @returns {number}
 */
function getElasticDelta(elastic) {
    if (!elastic || !elastic.use || elastic.tension == null) return 0;
    if (elastic.use === "resistance") return elastic.tension;
    if (elastic.use === "assistance") return -elastic.tension;
    return 0;
}

/**
 * Returns the effective load from a set-like object.
 * @param {Object|null} set
 * @returns {number}
 */
function getEffectiveLoad(set) {
    const weight = set?.weightLoad ?? 0;
    return weight + getElasticDelta(set?.elastic);
}

/**
 * Helper function to compare and assign PR.
 * A set is better if:
 *   1. It has higher effective load, OR
 *   2. Same effective load but higher value (reps/seconds)
 * Effective load = weightLoad + elastic.tension (resistance)
 *                = weightLoad - elastic.tension (assistance)
 *                = weightLoad (no elastic)
 * 
 * @param {Object|null} currentPR - The current PR to compare against.
 * @param {Object} newSet - The new set to compare with the current PR.
 * @returns {Object} - The updated PR if the new set is better, otherwise the current PR.
 */
function compareAndAssignPR(currentPR, newSet) {
    if (!currentPR) {
        return {
            value: newSet.value,
            weightLoad: newSet.weightLoad,
            elastic: newSet.elastic,
            date: newSet.date,
        };
    }

    const currentValue = currentPR.value ?? 0;
    const newValue = newSet.value ?? 0;
    const currentEffectiveLoad = getEffectiveLoad(currentPR);
    const newEffectiveLoad = getEffectiveLoad(newSet);

    // Check if new set is better
    let isBetter = false;

    // Higher effective load always wins
    if (newEffectiveLoad > currentEffectiveLoad) {
        isBetter = true;
    }
    // Same effective load: higher value wins
    else if (newEffectiveLoad === currentEffectiveLoad && newValue > currentValue) {
        isBetter = true;
    }

    if (isBetter) {
        return {
            value: newSet.value,
            weightLoad: newSet.weightLoad,
            elastic: newSet.elastic,
            date: newSet.date,
        };
    }

    return currentPR;
}

module.exports = { compareAndAssignPR, getElasticDelta, getEffectiveLoad };