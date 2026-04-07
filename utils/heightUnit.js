/**
 * Unité de taille affichée côté app (cm / ft).
 * @param {unknown} raw
 * @returns {'cm'|'ft'}
 */
function normalizeHeightUnit(raw) {
    if (raw === "ft" || raw === "cm") return raw;
    return "cm";
}

module.exports = { normalizeHeightUnit };
