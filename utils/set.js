/**
 * Helper function to compare and assign PR.
 * A set is better if:
 *   1. It has higher weightLoad, OR
 *   2. Same weightLoad but more reps/seconds, OR
 *   3. Better elastic (higher resistance tension, or lower assistance tension)
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
            elastic: newSet.elastic
        };
    }

    const currentWeight = currentPR.weightLoad || 0;
    const newWeight = newSet.weightLoad || 0;
    const currentValue = currentPR.value || 0;
    const newValue = newSet.value || 0;

    // Check if new set is better
    let isBetter = false;

    // Higher weight always wins
    if (newWeight > currentWeight) {
        isBetter = true;
    }
    // Same weight: more reps/seconds wins
    else if (newWeight === currentWeight && newValue > currentValue) {
        isBetter = true;
    }
    // Check elastic improvements (only if weights and values are equal or not applicable)
    else if (newSet.elastic?.use && newWeight >= currentWeight) {
        if (newSet.elastic.use === "resistance" && (newSet.elastic.tension || 0) > (currentPR.elastic?.tension || 0)) {
            isBetter = true;
        }
        if (newSet.elastic.use === "assistance" && (newSet.elastic.tension || 0) < (currentPR.elastic?.tension || Infinity)) {
            isBetter = true;
        }
    }

    if (isBetter) {
        return {
            value: newSet.value,
            weightLoad: newSet.weightLoad,
            elastic: newSet.elastic
        };
    }

    return currentPR;
}

module.exports = { compareAndAssignPR };