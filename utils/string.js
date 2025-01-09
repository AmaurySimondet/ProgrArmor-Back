function normalizeString(str) {
    return str
        .toLowerCase()
        // Remove accents/diacritics
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // Remove special characters
        .replace(/[^a-z0-9\s]/g, '')
        // Replace multiple spaces with single space
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    normalizeString
};