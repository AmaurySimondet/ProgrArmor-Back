const User = require("../schema/schemaUser.js");
const Seance = require("../schema/seance.js");
const SeanceSet = require("../schema/seanceset.js");
const mongoose = require('mongoose');
const { getTopExercices } = require('./set');
const { upsertNotification } = require('./notification');
const { KG_TO_LB } = require('../utils/seanceSetPersistedFields');
const { normalizeWeightUnit } = require('../utils/weightUnit');
const { normalizeHeightUnit } = require('../utils/heightUnit');
const { computeCurrentWeekStreak, getWeekIndex } = require('../utils/weekStreak');
const Notification = require('../schema/notification');
const UserMeasure = require("../schema/userMeasure");
const { backfillSeanceSetsForUser } = require("./seanceSetBackfill");
const {
    user: {
        ONE_DAY,
        CIRCUMFERENCE_KEYS,
        CM_PER_FT,
        KG_PER_LB,
        CM_PER_IN,
        HEIGHT_CM_DECIMALS,
        HEIGHT_FT_DECIMALS,
        WEIGHT_KG_DECIMALS,
        WEIGHT_LB_DECIMALS,
        CIRC_CM_DECIMALS,
        CIRC_IN_DECIMALS
    }
} = require('../constants');

function isPositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function throwValidationError(message) {
    const error = new Error(message);
    error.isValidationError = true;
    throw error;
}

function approximatelyEqual(a, b, decimals) {
    const tolerance = 1 / (10 ** decimals);
    return Math.abs(a - b) <= tolerance;
}

function buildDualUnitValue({
    input,
    metricKey,
    imperialKey,
    metricDecimals,
    imperialDecimals,
    metricToImperial,
    imperialToMetric,
    fieldLabel,
    required
}) {
    if (input === undefined || input === null) {
        if (required) {
            throwValidationError(`${fieldLabel} is required`);
        }
        return undefined;
    }

    if (typeof input !== "object" || Array.isArray(input)) {
        throwValidationError(`${fieldLabel} must be an object`);
    }

    const metricRaw = input[metricKey];
    const imperialRaw = input[imperialKey];

    if (metricRaw === undefined && imperialRaw === undefined) {
        throwValidationError(`${fieldLabel} must include ${metricKey} or ${imperialKey}`);
    }

    if (metricRaw !== undefined && !isPositiveNumber(metricRaw)) {
        throwValidationError(`${fieldLabel}.${metricKey} must be a positive number`);
    }
    if (imperialRaw !== undefined && !isPositiveNumber(imperialRaw)) {
        throwValidationError(`${fieldLabel}.${imperialKey} must be a positive number`);
    }

    let metricValue;
    if (metricRaw !== undefined && imperialRaw !== undefined) {
        const normalizedMetric = roundTo(metricRaw, metricDecimals);
        const normalizedImperial = roundTo(imperialRaw, imperialDecimals);
        const expectedImperial = roundTo(metricToImperial(normalizedMetric), imperialDecimals);

        if (!approximatelyEqual(normalizedImperial, expectedImperial, imperialDecimals)) {
            throwValidationError(
                `${fieldLabel}.${metricKey} and ${fieldLabel}.${imperialKey} are inconsistent`
            );
        }
        metricValue = normalizedMetric;
    } else if (metricRaw !== undefined) {
        metricValue = roundTo(metricRaw, metricDecimals);
    } else {
        metricValue = roundTo(imperialToMetric(imperialRaw), metricDecimals);
    }

    return {
        [metricKey]: metricValue,
        [imperialKey]: roundTo(metricToImperial(metricValue), imperialDecimals)
    };
}

function normalizeCircumferences(circumferences, required = false) {
    if (circumferences === undefined || circumferences === null) {
        if (required) {
            throwValidationError("circumferences is required");
        }
        return undefined;
    }

    if (typeof circumferences !== "object" || Array.isArray(circumferences)) {
        throwValidationError("circumferences must be an object");
    }

    const result = { cm: {}, in: {} };
    let hasAny = false;

    for (const key of CIRCUMFERENCE_KEYS) {
        const normalized = buildDualUnitValue({
            input: {
                cm: circumferences?.cm?.[key],
                in: circumferences?.in?.[key]
            },
            metricKey: "cm",
            imperialKey: "in",
            metricDecimals: CIRC_CM_DECIMALS,
            imperialDecimals: CIRC_IN_DECIMALS,
            metricToImperial: (cm) => cm / CM_PER_IN,
            imperialToMetric: (inch) => inch * CM_PER_IN,
            fieldLabel: `circumferences.${key}`,
            required: false
        });

        if (normalized) {
            result.cm[key] = normalized.cm;
            result.in[key] = normalized.in;
            hasAny = true;
        }
    }

    if (!hasAny) {
        return undefined;
    }

    return result;
}

function ensureUserCanAccess(userId, req, res) {
    if (!req.user || !req.user._id) {
        res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
        return false;
    }

    if (req.user._id.toString() !== userId.toString()) {
        res.status(403).json({
            success: false,
            message: "Forbidden"
        });
        return false;
    }

    return true;
}

function ensureAuthenticated(req, res) {
    if (!req.user || !req.user._id) {
        res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
        return false;
    }
    return true;
}

function shuffleArray(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

//COMPTE
/**
 * Modifies a user's information.
 * @param {Request} req - The request object containing user changes.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function modifyUser(req, res) {
    try {
        if (!req.body.id) {
            throw new Error("User ID is required");
        }

        const userId = req.body.id;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }
        if (!ensureUserCanAccess(userId, req, res)) {
            return;
        }

        const updateFields = { ...req.body };
        delete updateFields.id; // Remove id from update fields
        const forbiddenUpdateFields = new Set([
            '_id',
            'salt',
            'hash',
            'followers',
            'following',
            'facebookId',
            'googleId',
            'resetPasswordToken',
            'resetPasswordExpires'
        ]);
        Object.keys(updateFields).forEach((key) => {
            if (forbiddenUpdateFields.has(key)) {
                delete updateFields[key];
            }
        });

        if (Object.prototype.hasOwnProperty.call(updateFields, "weightUnit")) {
            updateFields.weightUnit = normalizeWeightUnit(updateFields.weightUnit);
        }
        if (Object.prototype.hasOwnProperty.call(updateFields, "heightUnit")) {
            updateFields.heightUnit = normalizeHeightUnit(updateFields.heightUnit);
        }

        // Handle password change separately if password is provided
        if (updateFields.password) {
            const user = await User.findById(userId);
            if (!user) {
                return res.json({
                    success: false,
                    message: "Utilisateur introuvable !"
                });
            }

            // Use setPassword from passport-local-mongoose
            await new Promise((resolve, reject) => {
                user.setPassword(updateFields.password, function (err) {
                    if (err) reject(err);
                    user.save().then(resolve).catch(reject);
                });
            });

            delete updateFields.password;
        }

        // Update other fields if any remain
        if (Object.keys(updateFields).length > 0) {
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                { $set: updateFields },
                { new: true }
            );

            if (!updatedUser) {
                return res.json({
                    success: false,
                    message: "Utilisateur introuvable !"
                });
            }
        }

        await backfillSeanceSetsForUser(userId);

        return res.json({
            success: true,
            message: "Profil mis à jour avec succès !",
            user: await User.findById(userId)
        });

    } catch (error) {
        console.error('Error modifying user:', error);
        return res.json({
            success: false,
            message: error.message
        });
    }
}


//GET USER INFO
/**
 * Fetches the user's information.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function getUser(req, res) {
    try {
        // Use query params instead of body for GET requests
        const { email, id } = req.query;

        if (!email && !id) {
            return res.status(400).json({
                success: false,
                message: "Email or ID is required"
            });
        }

        // Validate ObjectId if ID is provided
        if (id && !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        const conditions = email ? { email } : { _id: id };

        // Define projection to only fetch needed fields
        const projection = { salt: 0, hash: 0, updatedAt: 0, createdAt: 0, lastLogin: 0 };

        const user = await User.findOne(conditions, projection).lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur introuvable"
            });
        }

        user.weightUnit = normalizeWeightUnit(user.weightUnit);
        user.heightUnit = normalizeHeightUnit(user.heightUnit);

        return res.json({
            success: true,
            profile: user
        });

    } catch (error) {
        console.error('getUser error:', error);
        return res.status(500).json({
            success: false,
            message: "Une erreur est survenue lors de la récupération de l'utilisateur"
        });
    }
}

//GET USERS 
/**
 * Fetches all users.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function getUsers(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const searchQuery = req.query.search || '';

        // Create search condition if search query exists
        const searchCondition = searchQuery ? {
            $or: [
                { fName: { $regex: searchQuery, $options: 'i' } },
                { lName: { $regex: searchQuery, $options: 'i' } }
            ]
        } : {};

        const [aggregateResult] = await User.aggregate([
            { $match: searchCondition },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    users: [
                        {
                            $lookup: {
                                from: 'seances',
                                let: { userId: '$_id' },
                                pipeline: [
                                    { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
                                    { $count: 'count' }
                                ],
                                as: 'seanceCount'
                            }
                        },
                        { $addFields: { seanceCount: { $first: '$seanceCount.count' } } },
                        { $sort: { seanceCount: -1 } },
                        { $skip: skip },
                        { $limit: limit },
                    ]
                }
            }
        ]);

        const total = aggregateResult.total[0]?.count || 0;
        const result = {
            users: aggregateResult.users,
            total
        };

        return res.json({
            success: true,
            users: result.users,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(result.total / limit),
                totalUsers: result.total,
                hasMore: result.total > skip + limit
            }
        });

    } catch (e) {
        console.log(e);
        return res.json({ success: false, message: e.message });
    }
}

//SEARCH USERS
/**
 * Searches users by normalizedName field using regex.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function searchUsers(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const searchQuery = req.query.search || '';

        if (!searchQuery) {
            return res.json({
                success: false,
                message: "Search query is required"
            });
        }

        // Create search condition using regex on normalizedName field
        const searchCondition = {
            normalizedName: { $regex: searchQuery, $options: 'i' }
        };

        const [aggregateResult] = await User.aggregate([
            { $match: searchCondition },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    users: [
                        {
                            $lookup: {
                                from: 'seances',
                                let: { userId: '$_id' },
                                pipeline: [
                                    { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
                                    { $count: 'count' }
                                ],
                                as: 'seanceCount'
                            }
                        },
                        { $addFields: { seanceCount: { $first: '$seanceCount.count' } } },
                        { $sort: { seanceCount: -1 } },
                        { $skip: skip },
                        { $limit: limit },
                    ]
                }
            }
        ]);

        const total = aggregateResult.total[0]?.count || 0;
        const result = {
            users: aggregateResult.users,
            total
        };

        return res.json({
            success: true,
            users: result.users,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(result.total / limit),
                totalUsers: result.total,
                hasMore: result.total > skip + limit
            }
        });

    } catch (e) {
        console.log(e);
        return res.json({ success: false, message: e.message });
    }
}

/**
 * Fetches the user's all-time stats.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function userStats(req, res) {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        const userIdObj = new mongoose.Types.ObjectId(userId);

        const [
            seanceCount,
            topExercises,
            prCount,
            favoriteDayResult,
            totalVolumeResult,
        ] = await Promise.all([
            // Count total seances
            Seance.countDocuments({ user: userIdObj }),

            // Get top exercises
            getTopExercices(userId, null, null, 1, 20),

            // Count PRs grouped by variations.variation and date
            SeanceSet.aggregate([
                { $match: { user: userIdObj, PR: "PR" } },
                {
                    $group: {
                        _id: {
                            variation: "$variations.variation",
                            date: "$date"
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $count: "total"
                }
            ]).then(result => result[0]?.total || 0),

            // Get favorite day of week
            Seance.aggregate([
                { $match: { user: userIdObj } },
                { $group: { _id: { $dayOfWeek: "$date" }, count: { $sum: 1 } } },
                // Stable tie-breaker so the result is deterministic.
                { $sort: { count: -1, _id: 1 } },
                { $limit: 1 }
            ]),

            // Volume total : charge effective (kg/lb) persistée sur les sets — aligné avec l’app
            SeanceSet.aggregate([
                { $match: { user: userIdObj } },
                {
                    $addFields: {
                        loadKg: { $ifNull: ["$effectiveWeightLoad", "$weightLoad"] },
                        loadLbs: {
                            $ifNull: [
                                "$effectiveWeightLoadLbs",
                                {
                                    $ifNull: [
                                        "$weightLoadLbs",
                                        {
                                            $multiply: [
                                                { $ifNull: ["$effectiveWeightLoad", "$weightLoad"] },
                                                KG_TO_LB
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalKg: {
                            $sum: {
                                $cond: [
                                    { $eq: ["$unit", "repetitions"] },
                                    {
                                        $multiply: [
                                            { $ifNull: ["$loadKg", 0] },
                                            { $ifNull: ["$value", 0] }
                                        ]
                                    },
                                    { $ifNull: ["$loadKg", 0] }
                                ]
                            }
                        },
                        totalLbs: {
                            $sum: {
                                $cond: [
                                    { $eq: ["$unit", "repetitions"] },
                                    {
                                        $multiply: [
                                            { $ifNull: ["$loadLbs", 0] },
                                            { $ifNull: ["$value", 0] }
                                        ]
                                    },
                                    { $ifNull: ["$loadLbs", 0] }
                                ]
                            }
                        }
                    }
                }
            ]),

        ]);

        const favoriteDay = favoriteDayResult.length > 0
            // MongoDB $dayOfWeek: 1=Sunday ... 7=Saturday.
            ? favoriteDayResult[0]._id
            : null;

        const totalVolume = totalVolumeResult.length > 0
            ? totalVolumeResult[0].totalKg || 0
            : 0;

        const totalVolumeLbs = totalVolumeResult.length > 0
            ? totalVolumeResult[0].totalLbs || 0
            : 0;

        const stats = {
            seances: seanceCount,
            topExercices: topExercises,
            prs: prCount,
            favoriteDay: favoriteDay,
            totalVolume,
            totalVolumeLbs
        };

        return res.json({
            success: true,
            stats: stats
        });

    } catch (error) {
        console.error('[User Stats] Error:', error);
        return res.status(500).json({
            success: false,
            message: "Error fetching user stats"
        });
    }
}

/**
 * Follows a user.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function followUser(req, res) {
    try {
        if (!ensureAuthenticated(req, res)) {
            return;
        }

        const user = req.user._id.toString();
        const following = req.body.followingId;
        console.log("USER", user);
        console.log("FOLLOWING", following);
        if (!user || !following) {
            throw new Error("User ID and following ID are required");
        }

        //add following to following list
        const userToFollow = await User.findById(user);
        if (!userToFollow) {
            throw new Error(`User ${user} not found`);
        }
        if (userToFollow.following.includes(following)) {
            return res.json({
                success: false,
                message: "Already following this user"
            });
        }
        userToFollow.following.push(following);
        await userToFollow.save();

        //add user to followers list
        const followingUser = await User.findById(following);
        if (!followingUser) {
            throw new Error(`User ${following} not found`);
        }
        if (followingUser.followers.includes(user)) {
            return res.json({
                success: false,
                message: "Already following this user"
            });
        }
        followingUser.followers.push(user);
        await followingUser.save();

        // Create notification for the followed user
        await upsertNotification({
            type: 'follow',
            fromUser: user,
            forUser: following
        });

        return res.json({
            success: true,
            message: "User followed"
        });
    }
    catch (err) {
        console.error(err);
        return res.json({
            success: false,
            message: "Error following user"
        });
    }
}

/**
 * Unfollows a user.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function unfollowUser(req, res) {
    try {
        if (!ensureAuthenticated(req, res)) {
            return;
        }

        const user = req.user._id.toString();
        const unfollowing = req.body.unfollowingId;
        console.log("USER", user);
        console.log("UNFOLLOWING", unfollowing);
        if (!user || !unfollowing) {
            throw new Error("User ID and unfollowing ID are required");
        }

        //remove from following list
        const userToUnfollow = await User.findById(user);
        if (!userToUnfollow) {
            throw new Error(`User ${user} not found`);
        }
        if (!userToUnfollow.following.includes(unfollowing)) {
            return res.json({
                success: false,
                message: "Not following this user"
            });
        }
        userToUnfollow.following = userToUnfollow.following.filter(id => id.toString() !== unfollowing);
        await userToUnfollow.save();

        //remove from followers list
        const followingUser = await User.findById(unfollowing);
        if (!followingUser) {
            throw new Error(`User ${unfollowing} not found`);
        }
        if (!followingUser.followers.includes(user)) {
            return res.json({
                success: false,
                message: "Not following this user"
            });
        }
        followingUser.followers = followingUser.followers.filter(id => id.toString() !== user);
        await followingUser.save();

        // Delete any existing follow notifications
        await Notification.deleteMany({
            type: 'follow',
            fromUser: user,
            forUser: unfollowing
        });

        return res.json({
            success: true,
            message: "User unfollowed"
        });
    }
    catch (err) {
        console.error(err);
        return res.json({
            success: false,
            message: "Error unfollowing user"
        });
    }
}

/**
 * Suggest users to follow based on followings of followings.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function getFollowSuggestion(req, res) {
    try {
        if (!ensureAuthenticated(req, res)) {
            return;
        }

        const parsedLimit = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 3;

        const currentUser = await User.findById(req.user._id).select({ following: 1 }).lean();
        if (!currentUser) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const followingIds = (currentUser.following || []).map((id) => id.toString());
        const excludedIds = new Set([
            req.user._id.toString(),
            ...followingIds
        ]);

        const poolMultiplier = 4;
        const poolLimit = Math.min(limit * poolMultiplier, 200);

        const aggregateMostActiveUsers = async (matchStage) => User.aggregate([
            { $match: matchStage },
            {
                $lookup: {
                    from: 'seances',
                    let: { userId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
                        { $count: 'count' }
                    ],
                    as: 'seanceData'
                }
            },
            {
                $addFields: {
                    seanceCount: { $ifNull: [{ $first: '$seanceData.count' }, 0] }
                }
            },
            { $sort: { seanceCount: -1 } },
            { $limit: poolLimit },
            {
                $project: {
                    _id: 1,
                    fName: 1,
                    lName: 1,
                    profilePic: 1,
                    normalizedName: 1,
                    seanceCount: 1
                }
            }
        ]);

        let users = [];

        if (followingIds.length > 0) {
            const secondLevelFollowingIds = await User.distinct("following", {
                _id: { $in: currentUser.following }
            });

            const candidateIds = secondLevelFollowingIds
                .map((id) => id.toString())
                .filter((id) => !excludedIds.has(id))
                .map((id) => new mongoose.Types.ObjectId(id));

            if (candidateIds.length > 0) {
                const candidateUsers = await aggregateMostActiveUsers({ _id: { $in: candidateIds } });
                users = shuffleArray(candidateUsers).slice(0, limit);
            }
        }

        // Fallback for new users (or empty second-degree network): suggest globally active users.
        if (users.length === 0) {
            const fallbackUsers = await aggregateMostActiveUsers({
                _id: {
                    $nin: Array.from(excludedIds).map((id) => new mongoose.Types.ObjectId(id))
                }
            });
            users = shuffleArray(fallbackUsers).slice(0, limit);
        }

        return res.json({
            success: true,
            users
        });
    } catch (error) {
        console.error('[Follow Suggestion] Error:', error);
        return res.status(500).json({
            success: false,
            message: "Error fetching follow suggestions"
        });
    }
}

/**
 * Calculates and returns a user's all-time workout regularity score
 * @param {Request} req - The request object
 * @param {Response} res - The response object
 * @returns {Promise<void>} - A promise that resolves to void
 */
async function getRegularityScore(req, res) {
    try {
        const { userId } = req.query;
        if (!userId) {
            throw new Error("User ID is required");
        }

        const score = await (async () => {
            const seances = await Seance.find({ user: userId }).sort({ date: 1 });

            if (seances.length === 0) {
                return { average: 0, currentStreak: 0, bestStreak: 0, uniqueWeeks: 0, totalWeeksSinceFirstWorkout: 0, seances: [] };
            }

            const now = new Date();
            const currentWeekIndex = getWeekIndex(now);
            const firstSeanceWeekIndex = getWeekIndex(new Date(seances[0].date));
            const totalWeeksSinceFirstWorkout = currentWeekIndex - firstSeanceWeekIndex + 1;

            // Get unique weeks with workouts (sorted)
            const weekIndices = seances.map((s) => {
                const date = new Date(s?.date);
                if (!Number.isFinite(date.getTime())) return NaN;
                return getWeekIndex(date);
            });
            const uniqueWeeks = [...new Set(weekIndices)].sort((a, b) => a - b);

            // Average: ratio of weeks with at least one workout since first workout
            const average = Math.min(1, uniqueWeeks.length / totalWeeksSinceFirstWorkout);

            // Best streak: longest run of consecutive weeks
            let bestStreak = 1;
            let tempStreak = 1;
            for (let i = 1; i < uniqueWeeks.length; i++) {
                if (uniqueWeeks[i] === uniqueWeeks[i - 1] + 1) {
                    tempStreak++;
                    bestStreak = Math.max(bestStreak, tempStreak);
                } else {
                    tempStreak = 1;
                }
            }

            const currentStreak = computeCurrentWeekStreak(seances);

            return {
                average,
                uniqueWeeks: uniqueWeeks.length,
                totalWeeksSinceFirstWorkout,
                currentStreak,
                bestStreak,
                lastUpdated: Date.now(),
                seances
            };
        })();

        return res.json({
            success: true,
            ...score
        });

    } catch (error) {
        console.error('[Regularity Score] Error:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

async function updateLanguage(req, res) {
    try {
        const { userId, language } = req.body;
        console.log("USERID", userId);
        console.log("LANGUAGE", language);
        if (!userId || !language) {
            throw new Error("User ID and language are required");
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        if (!ensureUserCanAccess(userId, req, res)) {
            return;
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

        user.language = language;
        await user.save();

        return res.json({
            success: true,
            message: "Language updated"
        });
    } catch (error) {
        console.error('[Update Language] Error:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

async function updateWeightUnit(req, res) {
    try {
        const { userId, weightUnit } = req.body;
        if (!userId || weightUnit === undefined || weightUnit === null) {
            throw new Error("User ID and weightUnit are required");
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        if (!ensureUserCanAccess(userId, req, res)) {
            return;
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

        user.weightUnit = normalizeWeightUnit(weightUnit);
        await user.save();

        return res.json({
            success: true,
            message: "Weight unit updated"
        });
    } catch (error) {
        console.error('[Update Weight Unit] Error:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

async function updateHeightUnit(req, res) {
    try {
        const { userId, heightUnit } = req.body;
        if (!userId || heightUnit === undefined || heightUnit === null) {
            return res.status(400).json({
                success: false,
                message: "User ID and heightUnit are required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        if (!ensureUserCanAccess(userId, req, res)) {
            return;
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        user.heightUnit = normalizeHeightUnit(heightUnit);
        await user.save();

        return res.json({
            success: true,
            message: "Height unit updated",
            profile: user
        });
    } catch (error) {
        console.error('[Update Height Unit] Error:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

async function getLastUserMeasure(req, res) {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        if (!ensureAuthenticated(req, res)) {
            return;
        }

        const measure = await UserMeasure.findOne({ userId }).sort({ measuredAt: -1 }).lean();

        return res.json({
            success: true,
            measure: measure || null
        });
    } catch (error) {
        console.error('[Get Last User Measure] Error:', error);
        return res.status(500).json({
            success: false,
            message: "Error fetching last user measure"
        });
    }
}

async function getUserMeasures(req, res) {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        if (!ensureAuthenticated(req, res)) {
            return;
        }

        const measures = await UserMeasure.find({ userId }).sort({ measuredAt: -1 }).lean();

        return res.json({
            success: true,
            measures
        });
    } catch (error) {
        console.error('[Get User Measures] Error:', error);
        return res.status(500).json({
            success: false,
            message: "Error fetching user measures"
        });
    }
}

async function createUserMeasure(req, res) {
    try {
        const { userId, measuredAt, height, weight, bodyFatPct, circumferences } = req.body;

        if (!userId || !measuredAt || !height || !weight) {
            return res.status(400).json({
                success: false,
                message: "userId, measuredAt, height and weight are required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        if (!ensureUserCanAccess(userId, req, res)) {
            return;
        }

        const measuredAtDate = new Date(measuredAt);
        if (Number.isNaN(measuredAtDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid measuredAt date"
            });
        }

        const normalizedHeight = buildDualUnitValue({
            input: height,
            metricKey: "cm",
            imperialKey: "ft",
            metricDecimals: HEIGHT_CM_DECIMALS,
            imperialDecimals: HEIGHT_FT_DECIMALS,
            metricToImperial: (cm) => cm / CM_PER_FT,
            imperialToMetric: (ft) => ft * CM_PER_FT,
            fieldLabel: "height",
            required: true
        });

        const normalizedWeight = buildDualUnitValue({
            input: weight,
            metricKey: "kg",
            imperialKey: "lb",
            metricDecimals: WEIGHT_KG_DECIMALS,
            imperialDecimals: WEIGHT_LB_DECIMALS,
            metricToImperial: (kg) => kg / KG_PER_LB,
            imperialToMetric: (lb) => lb * KG_PER_LB,
            fieldLabel: "weight",
            required: true
        });

        if (bodyFatPct !== undefined && bodyFatPct !== null && !isPositiveNumber(bodyFatPct)) {
            return res.status(400).json({
                success: false,
                message: "bodyFatPct must be a positive number"
            });
        }

        const normalizedCircumferences = normalizeCircumferences(circumferences, false);

        const measure = await UserMeasure.create({
            userId,
            measuredAt: measuredAtDate,
            height: normalizedHeight,
            weight: normalizedWeight,
            bodyFatPct,
            circumferences: normalizedCircumferences
        });
        await backfillSeanceSetsForUser(userId);

        return res.json({
            success: true,
            measure
        });
    } catch (error) {
        console.error('[Create User Measure] Error:', error);
        if (error.isValidationError) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
        return res.status(500).json({
            success: false,
            message: "Error creating user measure"
        });
    }
}

async function updateUserMeasure(req, res) {
    try {
        const { userId, measureId, measuredAt, height, weight, bodyFatPct, circumferences } = req.body;

        if (!userId || !measureId) {
            return res.status(400).json({
                success: false,
                message: "userId and measureId are required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(measureId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid userId or measureId format"
            });
        }

        if (!ensureUserCanAccess(userId, req, res)) {
            return;
        }

        const measure = await UserMeasure.findOne({ _id: measureId, userId });
        if (!measure) {
            return res.status(404).json({
                success: false,
                message: "User measure not found"
            });
        }

        if (measuredAt !== undefined) {
            const measuredAtDate = new Date(measuredAt);
            if (Number.isNaN(measuredAtDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid measuredAt date"
                });
            }
            measure.measuredAt = measuredAtDate;
        }

        if (height !== undefined) {
            measure.height = buildDualUnitValue({
                input: height,
                metricKey: "cm",
                imperialKey: "ft",
                metricDecimals: HEIGHT_CM_DECIMALS,
                imperialDecimals: HEIGHT_FT_DECIMALS,
                metricToImperial: (cm) => cm / CM_PER_FT,
                imperialToMetric: (ft) => ft * CM_PER_FT,
                fieldLabel: "height",
                required: true
            });
        }

        if (weight !== undefined) {
            measure.weight = buildDualUnitValue({
                input: weight,
                metricKey: "kg",
                imperialKey: "lb",
                metricDecimals: WEIGHT_KG_DECIMALS,
                imperialDecimals: WEIGHT_LB_DECIMALS,
                metricToImperial: (kg) => kg / KG_PER_LB,
                imperialToMetric: (lb) => lb * KG_PER_LB,
                fieldLabel: "weight",
                required: true
            });
        }

        if (bodyFatPct !== undefined) {
            if (bodyFatPct !== null && !isPositiveNumber(bodyFatPct)) {
                return res.status(400).json({
                    success: false,
                    message: "bodyFatPct must be a positive number"
                });
            }
            measure.bodyFatPct = bodyFatPct;
        }

        if (circumferences !== undefined) {
            if (circumferences === null) {
                measure.circumferences = undefined;
            } else {
                measure.circumferences = normalizeCircumferences(circumferences, false);
            }
        }

        await measure.save();
        await backfillSeanceSetsForUser(userId);

        return res.json({
            success: true,
            message: "User measure updated",
            measure
        });
    } catch (error) {
        console.error('[Update User Measure] Error:', error);
        if (error.isValidationError) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
        return res.status(500).json({
            success: false,
            message: "Error updating user measure"
        });
    }
}

async function deleteUserMeasure(req, res) {
    try {
        const { userId, measureId } = req.body;

        if (!userId || !measureId) {
            return res.status(400).json({
                success: false,
                message: "userId and measureId are required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(measureId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid userId or measureId format"
            });
        }

        if (!ensureUserCanAccess(userId, req, res)) {
            return;
        }

        const deleted = await UserMeasure.findOneAndDelete({ _id: measureId, userId });
        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "User measure not found"
            });
        }

        return res.json({
            success: true,
            message: "User measure deleted"
        });
    } catch (error) {
        console.error('[Delete User Measure] Error:', error);
        return res.status(500).json({
            success: false,
            message: "Error deleting user measure"
        });
    }
}

/**
 * Fetches top users ranked by followers count and seance count.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function getTopUsers(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const users = await User.aggregate([
            // Add followers count from the followers array
            {
                $addFields: {
                    followersCount: { $size: { $ifNull: ['$followers', []] } }
                }
            },
            // Lookup seance count for each user
            {
                $lookup: {
                    from: 'seances',
                    let: { userId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
                        { $count: 'count' }
                    ],
                    as: 'seanceData'
                }
            },
            // Extract seance count
            {
                $addFields: {
                    seanceCount: { $ifNull: [{ $first: '$seanceData.count' }, 0] }
                }
            },
            // Calculate a combined score (followers weighted more heavily)
            {
                $addFields: {
                    score: {
                        $add: [
                            { $multiply: ['$followersCount', 2] },
                            '$seanceCount'
                        ]
                    }
                }
            },
            // Sort by score descending, then by followers, then by seance count
            { $sort: { score: -1, followersCount: -1, seanceCount: -1 } },
            // Limit results
            { $limit: limit },
            // Project only needed fields
            {
                $project: {
                    _id: 1,
                    fName: 1,
                    lName: 1,
                    profilePic: 1,
                    normalizedName: 1,
                    followersCount: 1,
                    seanceCount: 1,
                    score: 1
                }
            }
        ]);

        return res.json({
            success: true,
            users: users
        });

    } catch (error) {
        console.error('[Top Users] Error:', error);
        return res.status(500).json({
            success: false,
            message: "Error fetching top users"
        });
    }
}

module.exports = {
    modifyUser,
    getUser,
    getUsers,
    searchUsers,
    userStats,
    followUser,
    unfollowUser,
    getFollowSuggestion,
    getRegularityScore,
    updateLanguage,
    updateWeightUnit,
    updateHeightUnit,
    getLastUserMeasure,
    getUserMeasures,
    createUserMeasure,
    updateUserMeasure,
    deleteUserMeasure,
    getTopUsers
};