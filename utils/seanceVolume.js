/**
 * Volume total cumulé : somme de `seance.stats.totalWeight` (kg),
 * même source que les succès `sum_volume_total` et le save app.
 */

function sumSeanceTotalWeightKg(seances = []) {
    if (!Array.isArray(seances)) return 0;
    return seances.reduce((acc, s) => acc + Number(s?.stats?.totalWeight || 0), 0);
}

/** Expression `$sum` pour un `$group` MongoDB sur `stats.totalWeight`. */
function seanceTotalWeightKgMongoSum() {
    return { $sum: { $ifNull: ['$stats.totalWeight', 0] } };
}

module.exports = {
    sumSeanceTotalWeightKg,
    seanceTotalWeightKgMongoSum,
};
