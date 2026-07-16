/** Flags counted as personal records for totals (highlights, count_prs, seance_only_prs). */
const PERSONAL_RECORD_COUNT_FLAGS = Object.freeze(['PR', 'ATH']);

const PERSONAL_RECORD_COUNT_FLAG_SET = new Set(PERSONAL_RECORD_COUNT_FLAGS);

function isCountedPersonalRecordFlag(pr) {
    return PERSONAL_RECORD_COUNT_FLAG_SET.has(pr);
}

function countPersonalRecordSets(sets = []) {
    if (!Array.isArray(sets)) return 0;
    return sets.filter((s) => isCountedPersonalRecordFlag(s?.PR)).length;
}

function personalRecordFlagMongoMatch() {
    return { PR: { $in: [...PERSONAL_RECORD_COUNT_FLAGS] } };
}

module.exports = {
    PERSONAL_RECORD_COUNT_FLAGS,
    isCountedPersonalRecordFlag,
    countPersonalRecordSets,
    personalRecordFlagMongoMatch,
};
