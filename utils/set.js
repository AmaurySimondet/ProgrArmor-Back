/**
 * Helper function to compare and assign PR.
 * @param {Object|null} currentPR - The current PR to compare against.
 * @param {Object} newSet - The new set to compare with the current PR.
 * @returns {Object} - The updated PR if the new set is higher, otherwise the current PR.
 */
function compareAndAssignPR(currentPR, newSet) {
    if (!currentPR) {
        return {
            value: newSet.value,
            weightLoad: newSet.weightLoad,
            elastic: newSet.elastic
        };
    }
    // Replace the PR only if the weightLoad or elastic is higher or if the value itself is higher
    if (
        newSet.weightLoad > currentPR.weightLoad ||
        (newSet.elastic && newSet.elastic.use === "resistance" && newSet.elastic.tension > currentPR.elastic?.tension) ||
        (newSet.elastic && newSet.elastic.use === "assistance" && newSet.elastic.tension < currentPR.elastic?.tension)
    ) {
        return {
            value: newSet.value,
            weightLoad: newSet.weightLoad,
            elastic: newSet.elastic
        };
    }
    return currentPR;
}

module.exports = { compareAndAssignPR };