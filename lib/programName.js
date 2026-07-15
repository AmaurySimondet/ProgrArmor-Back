function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function programNamesMatch(nameA, nameB) {
    const normalizedA = String(nameA || '').trim();
    const normalizedB = String(nameB || '').trim();
    if (!normalizedA || !normalizedB) return false;
    return normalizedA.localeCompare(normalizedB, undefined, { sensitivity: 'accent' }) === 0;
}

function buildExactNameRegex(name) {
    const normalized = String(name || '').trim();
    return new RegExp(`^${escapeRegExp(normalized)}$`, 'i');
}

module.exports = {
    escapeRegExp,
    programNamesMatch,
    buildExactNameRegex,
};
