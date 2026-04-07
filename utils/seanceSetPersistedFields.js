/**
 * Champs optionnels persistés sur Seanceset (1RM, charges kg/lb) — alignés avec l’app (createSet).
 */
const mongoose = require("mongoose");

const PERSISTED_OPTIONAL_NUMBER_FIELDS = [
    "brzycki",
    "epley",
    "effectiveWeightLoad",
    "weightLoadLbs",
    "effectiveWeightLoadLbs",
];

/**
 * @param {*} value
 * @returns {number|null} null si entrée null ; nombre fini sinon
 * @throws {Error} si la valeur est présente mais non convertible en nombre fini
 */
function parseOptionalFiniteNumberOrNull(value) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
        throw new Error("nombre attendu (fini) ou null");
    }
    return n;
}

/**
 * Extrait et valide les champs persistés optionnels depuis le body client (createSet / futur updateSet).
 * @param {Object|null|undefined} setData
 * @returns {Object} copie de setData avec uniquement les clés connues normalisées (les autres inchangées)
 */
function mergePersistedOptionalFieldsFromClient(setData) {
    if (!setData || typeof setData !== "object") {
        return setData;
    }
    const out = { ...setData };
    for (const key of PERSISTED_OPTIONAL_NUMBER_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(setData, key)) {
            continue;
        }
        try {
            const parsed = parseOptionalFiniteNumberOrNull(setData[key]);
            if (parsed === undefined) {
                delete out[key];
            } else {
                out[key] = parsed;
            }
        } catch (e) {
            throw new Error(`set.${key}: ${e.message}`);
        }
    }
    if (Object.prototype.hasOwnProperty.call(setData, "prDetail")) {
        out.prDetail = normalizePrDetailObjectIds(setData.prDetail);
    }
    return out;
}

function toObjectIdIfValid(value) {
    if (value == null) return value;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
        return new mongoose.Types.ObjectId(value);
    }
    return value;
}

function normalizePrDetailObjectIds(prDetail) {
    if (!prDetail || typeof prDetail !== "object") {
        return prDetail;
    }
    const out = { ...prDetail };
    const referenceBestSet = prDetail.referenceBestSet;
    if (!referenceBestSet || typeof referenceBestSet !== "object") {
        return out;
    }

    const ref = { ...referenceBestSet };
    ref._id = toObjectIdIfValid(ref._id);
    ref.seance = toObjectIdIfValid(ref.seance);

    if (Array.isArray(ref.variations)) {
        ref.variations = ref.variations.map((variationItem) => {
            if (!variationItem || typeof variationItem !== "object") {
                return variationItem;
            }
            return {
                ...variationItem,
                variation: toObjectIdIfValid(variationItem.variation),
                type: toObjectIdIfValid(variationItem.type),
            };
        });
    }

    out.referenceBestSet = ref;
    return out;
}

/** Facteur kg → lb (aligné usage courant ; ~2 décimales en sortie migration) */
const KG_TO_LB = 2.2046226218487757;

function round2(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return null;
    }
    return Math.round(value * 100) / 100;
}

module.exports = {
    PERSISTED_OPTIONAL_NUMBER_FIELDS,
    parseOptionalFiniteNumberOrNull,
    mergePersistedOptionalFieldsFromClient,
    KG_TO_LB,
    round2,
    normalizePrDetailObjectIds,
};
