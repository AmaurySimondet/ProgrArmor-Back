const set = require('../lib/set.js');
const whichweight = require('../lib/whichweight');
const whichvalue = require('../lib/whichvalue');
const whichfigure = require('../lib/whichfigure');

module.exports = function (app) {
    const DEFAULT_REFERENCE_VARIATION_ID = '669c3609218324e0b7682b2b'; // tuck
    app.get('/sets', async (req, res) => {
        try {
            const excludedSeanceId = req.query.excludedSeanceId;
            const seanceId = req.query.seanceId;
            const userId = req.query.userId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const unit = req.query.unit;
            const value = req.query.value;
            const valueMin = req.query.valueMin;
            const valueMax = req.query.valueMax;
            const weightLoad = req.query.weightLoad;
            const elasticTension = req.query['elastic.tension'];
            const dateMin = req.query.dateMin;
            const dateMax = req.query.dateMax;
            const fields = req.query.fields;
            const variations = req.query.variations;
            const unilateralSide = req.query.unilateralSide;
            const sets = await set.getSets(userId, excludedSeanceId, seanceId, exercice, categories, unit, value, weightLoad, elasticTension, dateMin, dateMax, fields, variations, unilateralSide, undefined, valueMin, valueMax);
            res.json({ success: true, sets });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/variation-progression/timeseries', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            const userId = req.query.userId;
            if (!authenticatedUserId || authenticatedUserId !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    reason: 'FORBIDDEN',
                    message: 'Accès non autorisé pour cet utilisateur. / Unauthorized access for this user.'
                });
            }

            const referenceVariations = req.query.referenceVariations || DEFAULT_REFERENCE_VARIATION_ID;
            const mainExerciseId = req.query.mainExerciseId || null;
            const dateMin = req.query.dateMin;
            const dateMax = req.query.dateMax;
            const valueMin = req.query.valueMin;
            const valueMax = req.query.valueMax;
            const unit = req.query.unit || null;
            let isUnilateral = undefined;
            if (req.query.isUnilateral === 'true') isUnilateral = true;
            else if (req.query.isUnilateral === 'false') isUnilateral = false;

            const result = await set.getNormalizedProgressionTimeseries({
                userId,
                referenceVariations,
                mainExerciseId,
                dateMin,
                dateMax,
                valueMin,
                valueMax,
                unit,
                unilateralSide: req.query.unilateralSide,
                isUnilateral
            });
            return res.json({ success: true, ...result });
        } catch (err) {
            console.error('Error in /variation-progression/timeseries:', err);
            return res.status(500).json({ success: false, message: err.message });
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

    app.post('/whichweight-figure', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            const {
                userId,
                mainExerciseId,
                referenceVariations,
                targetUnit,
                targetValue,
                includeAllGraphTargets,
                expandGenericTargets,
                maxTargets,
                exercice,
                categories,
                dateMin,
                unilateralSide
            } = req.body || {};
            if (!authenticatedUserId || authenticatedUserId !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    reason: 'FORBIDDEN',
                    message: 'Accès non autorisé pour cet utilisateur. / Unauthorized access for this user.'
                });
            }
            const result = await whichfigure.computeRecommendedWeightFigure({
                userId,
                mainExerciseId,
                referenceVariations: referenceVariations || DEFAULT_REFERENCE_VARIATION_ID,
                targetUnit,
                targetValue,
                includeAllGraphTargets: includeAllGraphTargets !== false,
                expandGenericTargets: expandGenericTargets !== false,
                maxTargets,
                exercice,
                categories,
                dateMin,
                unilateralSide
            });
            return res.json(result);
        } catch (err) {
            console.error('Error in /whichweight-figure:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/whichvalue-figure', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            const {
                userId,
                mainExerciseId,
                referenceVariations,
                targetUnit,
                effectiveWeightLoad,
                includeAllGraphTargets,
                expandGenericTargets,
                maxTargets,
                exercice,
                categories,
                dateMin,
                unilateralSide
            } = req.body || {};
            if (!authenticatedUserId || authenticatedUserId !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    reason: 'FORBIDDEN',
                    message: 'Accès non autorisé pour cet utilisateur. / Unauthorized access for this user.'
                });
            }
            const result = await whichfigure.computeRecommendedValueFigure({
                userId,
                mainExerciseId,
                referenceVariations: referenceVariations || DEFAULT_REFERENCE_VARIATION_ID,
                targetUnit,
                effectiveWeightLoad,
                includeAllGraphTargets: includeAllGraphTargets !== false,
                expandGenericTargets: expandGenericTargets !== false,
                maxTargets,
                exercice,
                categories,
                dateMin,
                unilateralSide
            });
            return res.json(result);
        } catch (err) {
            console.error('Error in /whichvalue-figure:', err);
            return res.status(500).json({ success: false, message: err.message });
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

    app.get('/figure-prs', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            const userId = req.query.userId;
            if (!authenticatedUserId || authenticatedUserId !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    reason: 'FORBIDDEN',
                    message: 'Accès non autorisé pour cet utilisateur. / Unauthorized access for this user.'
                });
            }

            const excludedSeanceId = req.query.excludedSeanceId;
            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const dateMin = req.query.dateMin;
            const unilateralSide = req.query.unilateralSide;
            const referenceVariations = req.query.referenceVariations || DEFAULT_REFERENCE_VARIATION_ID;
            const mainExerciseId = req.query.mainExerciseId;
            const includeAllGraphTargets = req.query.includeAllGraphTargets === 'true';
            const maxTargetsRaw = parseInt(req.query.maxTargets, 10);
            const maxTargets = Number.isFinite(maxTargetsRaw) ? maxTargetsRaw : 40;

            const payload = await set.getFigurePRs({
                userId,
                excludedSeanceId,
                exercice,
                categories,
                dateMin,
                unilateralSide,
                referenceVariations,
                mainExerciseId,
                includeAllGraphTargets,
                maxTargets
            });
            return res.json({ success: true, ...payload });
        } catch (err) {
            console.error('Error in /figure-prs:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/figure-detailed-prs', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            const userId = req.query.userId;
            if (!authenticatedUserId || authenticatedUserId !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    reason: 'FORBIDDEN',
                    message: 'Accès non autorisé pour cet utilisateur. / Unauthorized access for this user.'
                });
            }

            const exercice = req.query.exercice;
            const categories = req.query.categories;
            const dateMin = req.query.dateMin;
            const unilateralSide = req.query.unilateralSide;
            const referenceVariations = req.query.referenceVariations || DEFAULT_REFERENCE_VARIATION_ID;
            const mainExerciseId = req.query.mainExerciseId;
            const includeAllGraphTargets = req.query.includeAllGraphTargets === 'true';
            const maxTargetsRaw = parseInt(req.query.maxTargets, 10);
            const maxTargets = Number.isFinite(maxTargetsRaw) ? maxTargetsRaw : 40;

            const payload = await set.getFigureDetailedPRs({
                userId,
                exercice,
                categories,
                dateMin,
                unilateralSide,
                referenceVariations,
                mainExerciseId,
                includeAllGraphTargets,
                maxTargets
            });
            return res.json({ success: true, ...payload });
        } catch (err) {
            console.error('Error in /figure-detailed-prs:', err);
            return res.status(500).json({ success: false, message: err.message });
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