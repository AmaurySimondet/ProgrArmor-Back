const set = require('../lib/set.js');
const whichweight = require('../lib/whichweight');
const whichvalue = require('../lib/whichvalue');

module.exports = function (app) {
    app.get('/sets', async (req, res) => {
        try {
            const excludedSeanceId = req.query.excludedSeanceId;
            const seanceId = req.query.seanceId;
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const unit = req.query.unit;
            const value = req.query.value;
            const weightLoad = req.query.weightLoad;
            const elasticTension = req.query['elastic.tension'];
            const dateMin = req.query.dateMin;
            const dateMax = req.query.dateMax;
            const fields = req.query.fields;
            const variations = req.query.variations;
            const unilateralSide = req.query.unilateralSide;
            const sets = await set.getSets(userId, excludedSeanceId, seanceId, exercice, categories, unit, value, weightLoad, elasticTension, dateMin, dateMax, fields, variations, unilateralSide);
            res.json({ success: true, sets });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/whichweight', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            const {
                userId,
                variations,
                targetUnit,
                targetValue,
                maxSets,
                sessionSets,
                isUnilateral,
                unilateralSide,
            } = req.body || {};

            if (!authenticatedUserId || authenticatedUserId !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    reason: 'FORBIDDEN',
                    message: 'Accès non autorisé pour cet utilisateur. / Unauthorized access for this user.'
                });
            }

            const result = await whichweight.computeRecommendedLoad({
                userId,
                variations,
                targetUnit,
                targetValue,
                maxSets,
                sessionSets,
                isUnilateral,
                unilateralSide,
            });
            res.json(result);
        } catch (err) {
            console.error('Error in /whichweight:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/whichvalue', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            const {
                userId,
                variations,
                targetUnit,
                effectiveWeightLoad,
                maxSets,
                sessionSets,
                isUnilateral,
                unilateralSide,
            } = req.body || {};

            if (!authenticatedUserId || authenticatedUserId !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    reason: 'FORBIDDEN',
                    message: 'Accès non autorisé pour cet utilisateur. / Unauthorized access for this user.'
                });
            }

            const result = await whichvalue.computeRecommendedValue({
                userId,
                variations,
                targetUnit,
                effectiveWeightLoad,
                maxSets,
                sessionSets,
                isUnilateral,
                unilateralSide,
            });
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/prs', async (req, res) => {
        try {
            const userId = req.query.userId;
            const excludedSeanceId = req.query.excludedSeanceId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const dateMin = req.query.dateMin;
            const variations = req.query.variations;
            const unilateralSide = req.query.unilateralSide;
            const prs = await set.getPRs(userId, excludedSeanceId, exercice, categories, dateMin, variations, unilateralSide);
            res.json({ success: true, prs });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/detailedPrs', async (req, res) => {
        try {
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const dateMin = req.query.dateMin;
            const variations = req.query.variations;
            const unilateralSide = req.query.unilateralSide;
            const prs = await set.getDetailedPRs(userId, exercice, categories, dateMin, variations, unilateralSide);
            res.json({ success: true, prs });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/ispr', async (req, res) => {
        try {
            const userId = req.query.userId;
            const seanceId = req.query.seanceId;
            const unit = req.query.unit;
            const value = parseFloat(req.query.value);
            const weightLoad = parseFloat(req.query.weightLoad);
            let elastic = null;
            if (req.query.elastic) {
                elastic = {
                    use: req.query.elastic?.use,
                    tension: parseFloat(req.query.elastic?.tension)
                };
            }
            const variations = req.query.variations;
            let effectiveWeightLoadOverride = undefined;
            const effRaw = req.query.effectiveWeightLoad;
            if (effRaw !== undefined && effRaw !== "") {
                const n = parseFloat(effRaw);
                effectiveWeightLoadOverride = Number.isFinite(n) ? n : undefined;
            }
            let isUnilateral = undefined;
            if (req.query.isUnilateral === 'true') isUnilateral = true;
            else if (req.query.isUnilateral === 'false') isUnilateral = false;
            const unilateralSide = req.query.unilateralSide;
            const { isPersonalRecord, prDetail } = await set.isPersonalRecordWithDetail(
                userId,
                seanceId,
                unit,
                value,
                weightLoad,
                elastic,
                variations,
                effectiveWeightLoadOverride,
                isUnilateral,
                unilateralSide
            );
            console.log("isPersonalRecord response for userId:", userId, "seanceId:", seanceId, "unit:", unit, "value:", value, "weightLoad:", weightLoad, "elastic:", elastic, "variations:", variations, "isPersonalRecord:", isPersonalRecord, "prDetail:", prDetail);
            res.json({ success: true, isPersonalRecord, prDetail });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/topExercices', async (req, res) => {
        try {
            const userId = req.query.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;
            const seanceName = req.query.seanceName;

            const { topExercices, total } = await set.getTopExercices(userId, req.query.by, req.query.asc, page, limit, seanceName);

            res.json({
                success: true,
                topExercices,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/personalRecordsSummary', async (req, res) => {
        try {
            const userId = req.query.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const dateMin = req.query.dateMin;
            const personalRecordsSummary = await set.getPersonalRecordsSummary(userId, page, limit, dateMin);
            res.json({ success: true, ...personalRecordsSummary });
        } catch (err) {
            console.error("Error fetching personal records summary:", err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/lastFormats', async (req, res) => {
        try {
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;

            const { lastFormats, total } = await set.getLastFormats(userId, exercice, categories, page, limit);
            res.json({
                success: true,
                lastFormats,
                pagination: {
                    page,
                    limit,
                    total,
                    hasMore: total > page * limit
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // POST
    app.post('/createSet', async (req, res) => {
        try {
            const setData = req.body.set;
            const newSet = await set.createSet(setData);
            res.json({ success: true, newSet });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // DELETE
    app.delete('/deleteSets', async (req, res) => {
        try {
            const seanceId = req.query.seanceId;
            await set.deleteSets(seanceId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}