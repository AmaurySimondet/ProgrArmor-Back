/**
 * Unité de poids affichée côté app (kg / lb).
 * @param {unknown} raw
 * @returns {'kg'|'lb'}
 */
function normalizeWeightUnit(raw) {
    if (raw === "lb" || raw === "kg") return raw;
    return "kg";
}

module.exports = { normalizeWeightUnit };
