const set = require('../lib/set.js');
const whichweight = require('../lib/whichweight');
const whichvalue = require('../lib/whichvalue');
const whichfigure = require('../lib/whichfigure');
const { computeStrengthPeakFromSets, normalizeWeightUnit } = require('../lib/strengthPeak');
const Seance = require('../schema/seance');

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
            const sortedSets = Array.isArray(sets)
                ? [...sets].filter((s) => s?.date).sort((a, b) => new Date(a.date) - new Date(b.date))
                : [];
            const strengthPeak = userId && variations
                ? computeStrengthPeakFromSets(sortedSets, {
                    weightUnit: normalizeWeightUnit(req.query.weightUnit),
                })
                : null;
            res.json({
                success: true,
                sets,
                meta: {
                    strengthPeak,
                    setsCount: sortedSets.length,
                },
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/variation-progression/timeseries', async (req, res) => {
        try {
            const userId = req.query.userId;

            const referenceVariations = req.query.referenceVariations;
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
                isUnilateral,
                lateralMode: req.query.lateralMode,
                includedVariationIds: req.query.includedVariationIds,
                excludedVariationSignatures: req.query.excludedVariationSignatures,
                weightUnit: normalizeWeightUnit(req.query.weightUnit),
            });
            return res.json({ success: true, ...result });
        } catch (err) {
            console.error('Error in /variation-progression/timeseries:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/whichweight', async (req, res) => {
        try {
            const {
                userId,
                variations,
                targetUnit,
                targetValue,
                sessionSets,
                isUnilateral,
                unilateralSide,
            } = req.body || {};

            const result = await whichweight.computeRecommendedLoad({
                userId,
                variations,
                targetUnit,
                targetValue,
                sessionSets,
                isUnilateral,
                unilateralSide,
            });
            console.debug('[api][whichweight] response-summary', {
                success: result?.success !== false,
                loadKg: result?.loadKg ?? null,
                usedHistoricalSets: result?.usedSets?.usedHistoricalSets ?? null,
                usedSessionSets: result?.usedSets?.usedSessionSets ?? null,
                targetVariationId: result?.targetVariation?.variationId ?? null,
            });
            res.json(result);
        } catch (err) {
            console.error('Error in /whichweight:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/whichvalue', async (req, res) => {
        try {
            const {
                userId,
                variations,
                targetUnit,
                effectiveWeightLoad,
                sessionSets,
                isUnilateral,
                unilateralSide,
            } = req.body || {};

            const result = await whichvalue.computeRecommendedValue({
                userId,
                variations,
                targetUnit,
                effectiveWeightLoad,
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
                unilateralSide,
                lateralMode,
                familyKey,
                sessionSets,
                isUnilateral,
            } = req.body || {};
            const result = await whichfigure.computeRecommendedWeightFigure({
                userId,
                mainExerciseId,
                referenceVariations,
                targetUnit,
                targetValue,
                includeAllGraphTargets: includeAllGraphTargets === true,
                expandGenericTargets: expandGenericTargets === true,
                maxTargets,
                exercice,
                categories,
                dateMin,
                unilateralSide,
                lateralMode,
                familyKey,
                sessionSets,
                isUnilateral: isUnilateral === true,
            });
            const directRec = (result?.recommendations || []).find((e) => e?.isDirect === true);
            console.debug('[api][whichweight-figure] response-summary', {
                success: result?.success !== false,
                referenceVariationId: result?.referenceVariationId ?? null,
                directRecommendedLoadKg: directRec?.recommendedLoadKg ?? null,
                directUsedHistoricalSets: directRec?.usedSets?.usedHistoricalSets ?? null,
                recommendationCount: result?.recommendations?.length ?? 0,
            });
            return res.json(result);
        } catch (err) {
            console.error('Error in /whichweight-figure:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/whichvalue-figure', async (req, res) => {
        try {
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
                unilateralSide,
                lateralMode,
                familyKey,
                sessionSets,
                isUnilateral,
            } = req.body || {};
            const result = await whichfigure.computeRecommendedValueFigure({
                userId,
                mainExerciseId,
                referenceVariations,
                targetUnit,
                effectiveWeightLoad,
                includeAllGraphTargets: includeAllGraphTargets === true,
                expandGenericTargets: expandGenericTargets === true,
                maxTargets,
                exercice,
                categories,
                dateMin,
                unilateralSide,
                lateralMode,
                familyKey,
                sessionSets,
                isUnilateral: isUnilateral === true,
            });
            return res.json(result);
        } catch (err) {
            console.error('Error in /whichvalue-figure:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
    });

    /** @deprecated Préférer GET /progression-prs — conservé pour le best set workout (merge equivalentTo). */
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

    app.get('/variation-family/performed', async (req, res) => {
        try {
            const userId = req.query.userId;

            const rawVariations = req.query.variations;
            const variationIds = (Array.isArray(rawVariations) ? rawVariations : [rawVariations])
                .flatMap((value) => {
                    if (value == null) return [];
                    if (typeof value === 'string') {
                        return value.split(',').map((id) => id.trim()).filter(Boolean);
                    }
                    if (typeof value === 'object' && value.variation) {
                        return [String(value.variation)];
                    }
                    return [String(value)];
                })
                .filter(Boolean);
            const legacyRootVariationId = req.query.rootVariationId;
            const inputVariations = variationIds.length > 0
                ? variationIds
                : (legacyRootVariationId ? [String(legacyRootVariationId)] : []);
            if (!inputVariations.length) {
                return res.status(400).json({
                    success: false,
                    reason: 'VALIDATION_ERROR',
                    message: 'variations est requis (liste d\'ids)'
                });
            }

            const maxDepthRaw = parseInt(req.query.maxDepth, 10);
            const lateralMode = req.query.lateralMode || null;
            const unilateralSideFromQuery = req.query.unilateralSide
                || (lateralMode === 'left' || lateralMode === 'right' ? lateralMode : undefined);
            const payload = await set.getNormalFlowPerformedVariationFamilies({
                userId,
                variations: inputVariations,
                maxDepth: Number.isFinite(maxDepthRaw) ? maxDepthRaw : undefined,
                dateMin: req.query.dateMin || null,
                unilateralSide: unilateralSideFromQuery,
                lateralMode: lateralMode || undefined,
            });

            return res.json({
                success: true,
                ...payload,
                frontFlow: {
                    stepA: 'call variation-family/performed with variations[]',
                    stepB: 'show family buttons then performed variations from performedVariationsByFamily',
                    stepC: 'on variation click keep current flow with /variation-progression/timeseries and /prs or /detailedPrs'
                }
            });
        } catch (err) {
            console.error('Error in /variation-family/performed:', err);
            const isValidationError = typeof err?.message === 'string'
                && err.message.startsWith('variations invalide');
            return res.status(isValidationError ? 400 : 500).json({
                success: false,
                ...(isValidationError ? { reason: 'VALIDATION_ERROR' } : {}),
                message: err.message
            });
        }
    });

    /** @deprecated Préférer GET /progression-detailed-prs */
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

    const handleProgressionPrsRequest = async (req, res, { detailed = false } = {}) => {
        try {
            const userId = req.query.userId;
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    reason: 'VALIDATION_ERROR',
                    message: 'userId est requis. / userId is required.'
                });
            }

            const params = {
                userId,
                exercice: req.query.exercice,
                categories: req.query.categories,
                dateMin: req.query.dateMin,
                unilateralSide: req.query.unilateralSide,
                lateralMode: req.query.lateralMode,
                includedVariationIds: req.query.includedVariationIds,
                excludedVariationSignatures: req.query.excludedVariationSignatures,
                referenceVariations: req.query.referenceVariations,
                mainExerciseId: req.query.mainExerciseId,
                includeAllGraphTargets: req.query.includeAllGraphTargets === 'true',
                maxTargets: Number.isFinite(parseInt(req.query.maxTargets, 10))
                    ? parseInt(req.query.maxTargets, 10)
                    : 40,
            };

            const payload = detailed
                ? await set.getProgressionDetailedPRs(params)
                : await set.getProgressionPRs({
                    ...params,
                    excludedSeanceId: req.query.excludedSeanceId,
                });
            return res.json({ success: true, ...payload });
        } catch (err) {
            console.error(`Error in progression PRs (${detailed ? 'detailed' : 'summary'}):`, err);
            return res.status(500).json({ success: false, message: err.message });
        }
    };

    app.get('/progression-prs', (req, res) => handleProgressionPrsRequest(req, res, { detailed: false }));
    app.get('/progression-detailed-prs', (req, res) => handleProgressionPrsRequest(req, res, { detailed: true }));
    app.get('/figure-prs', (req, res) => handleProgressionPrsRequest(req, res, { detailed: false }));
    app.get('/figure-detailed-prs', (req, res) => handleProgressionPrsRequest(req, res, { detailed: true }));

    const parsePrEvaluationOptions = (data) => {
        const seanceDateRaw = data.seanceDate
            ?? data.prEvaluationOptions?.historicalBeforeDate
            ?? data.prEvaluationOptions?.referenceDate;
        if (seanceDateRaw != null && seanceDateRaw !== '') {
            const seanceDate = new Date(seanceDateRaw);
            if (!Number.isNaN(seanceDate.getTime())) {
                return {
                    historicalBeforeDate: seanceDate,
                    referenceDate: seanceDate,
                };
            }
        }
        if (data.prEvaluationOptions && typeof data.prEvaluationOptions === 'object') {
            const { historicalBeforeDate, referenceDate } = data.prEvaluationOptions;
            if (historicalBeforeDate != null || referenceDate != null) {
                return {
                    ...(historicalBeforeDate != null ? { historicalBeforeDate } : {}),
                    ...(referenceDate != null ? { referenceDate } : {}),
                };
            }
        }
        return undefined;
    };

    const parseIsPrSetInput = (rawSet) => {
        let elastic = null;
        if (rawSet.elastic) {
            elastic = {
                type: rawSet.elastic?.type,
                use: rawSet.elastic?.use,
                tension: parseFloat(rawSet.elastic?.tension),
            };
        }
        let effectiveWeightLoadOverride = undefined;
        const effRaw = rawSet.effectiveWeightLoad;
        if (effRaw !== undefined && effRaw !== '') {
            const n = parseFloat(effRaw);
            effectiveWeightLoadOverride = Number.isFinite(n) ? n : undefined;
        }
        let isUnilateral = undefined;
        if (rawSet.isUnilateral === true || rawSet.isUnilateral === 'true') isUnilateral = true;
        else if (rawSet.isUnilateral === false || rawSet.isUnilateral === 'false') isUnilateral = false;
        const cardio = rawSet.cardio && typeof rawSet.cardio === 'object' ? rawSet.cardio : undefined;
        return {
            setId: rawSet.setId ?? rawSet._id ?? rawSet.id,
            unit: rawSet.unit,
            value: parseFloat(rawSet.value),
            weightLoad: parseFloat(rawSet.weightLoad),
            elastic,
            effectiveWeightLoadOverride,
            isUnilateral,
            unilateralSide: rawSet.unilateralSide,
            cardio,
        };
    };

    const handleIsPrRequest = async (req, res, { source = 'body' } = {}) => {
        const data = source === 'query' ? (req.query || {}) : (req.body || {});
        const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
        if (!authenticatedUserId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const requestedUserId = data.userId != null ? String(data.userId) : null;
        if (!requestedUserId || requestedUserId !== authenticatedUserId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const userId = authenticatedUserId;
        const seanceId = data.seanceId;
        const unit = data.unit;
        const value = parseFloat(data.value);
        const weightLoad = parseFloat(data.weightLoad);
        let elastic = null;
        if (data.elastic) {
            elastic = {
                type: data.elastic?.type,
                use: data.elastic?.use,
                tension: parseFloat(data.elastic?.tension),
            };
        }
        const variations = data.variations;
        let effectiveWeightLoadOverride = undefined;
        const effRaw = data.effectiveWeightLoad;
        if (effRaw !== undefined && effRaw !== '') {
            const n = parseFloat(effRaw);
            effectiveWeightLoadOverride = Number.isFinite(n) ? n : undefined;
        }
        let isUnilateral = undefined;
        if (data.isUnilateral === true || data.isUnilateral === 'true') isUnilateral = true;
        else if (data.isUnilateral === false || data.isUnilateral === 'false') isUnilateral = false;
        const unilateralSide = data.unilateralSide;
        const sessionSets = source === 'body' ? data.sessionSets : undefined;
        const excludeSetId = source === 'body' ? data.excludeSetId : undefined;
        const cardio = data.cardio && typeof data.cardio === 'object' ? data.cardio : undefined;
        const prEvaluationOptions = parsePrEvaluationOptions(data);

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
            unilateralSide,
            sessionSets,
            excludeSetId,
            cardio,
            prEvaluationOptions,
        );

        res.json({ success: true, isPersonalRecord, prDetail });
    };

    app.post('/ispr', async (req, res) => {
        try {
            await handleIsPrRequest(req, res, { source: 'body' });
        } catch (err) {
            console.error('[POST /ispr] Error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/ispr', async (req, res) => {
        try {
            await handleIsPrRequest(req, res, { source: 'query' });
        } catch (err) {
            console.error('[GET /ispr] Error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/ispr/batch', async (req, res) => {
        try {
            const data = req.body || {};
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const requestedUserId = data.userId != null ? String(data.userId) : null;
            if (!requestedUserId || requestedUserId !== authenticatedUserId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }

            const sets = Array.isArray(data.sets) ? data.sets : [];
            if (sets.length === 0) {
                return res.json({ success: true, results: [] });
            }

            const prEvaluationOptions = parsePrEvaluationOptions(data);
            const parsedSets = sets
                .map(parseIsPrSetInput)
                .filter((setInput) => setInput.setId != null);

            const results = await set.evaluatePersonalRecordsBatch({
                userId: authenticatedUserId,
                seanceId: data.seanceId,
                variations: data.variations,
                prEvaluationOptions,
                sets: parsedSets,
                sessionSets: data.sessionSets,
            });

            res.json({ success: true, results });
        } catch (err) {
            console.error('[POST /ispr/batch] Error:', err);
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
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }
            const setData = req.body.set;
            if (!setData || !setData.seance) {
                return res.status(400).json({ success: false, message: "Set and seance are required" });
            }
            const ownerSeance = await Seance.findOne({ _id: setData.seance, user: authenticatedUserId }, { _id: 1 }).lean();
            if (!ownerSeance) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            setData.user = authenticatedUserId;
            const newSet = await set.createSet(setData);
            res.json({ success: true, newSet });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // DELETE
    app.delete('/deleteSets', async (req, res) => {
        try {
            const authenticatedUserId = req.user && req.user._id ? req.user._id.toString() : null;
            if (!authenticatedUserId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }
            const seanceId = req.query.seanceId;
            if (!seanceId) {
                return res.status(400).json({ success: false, message: "Seance ID is required" });
            }
            const ownerSeance = await Seance.findOne({ _id: seanceId, user: authenticatedUserId }, { _id: 1 }).lean();
            if (!ownerSeance) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            await set.deleteSets(seanceId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
}