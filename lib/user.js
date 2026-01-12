const User = require("../schema/schemaUser.js");
const Seance = require("../schema/seance.js");
const SeanceSet = require("../schema/seanceset.js");
const { getOrSetCache, invalidateUserCaches, invalidateCacheStartingWith } = require('../utils/cache');
const mongoose = require('mongoose');
const { getTopExercices } = require('./set');
const { upsertNotification } = require('./notification');
const Notification = require('../schema/notification');
const ONE_DAY = 24 * 60 * 60 * 1000;

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
        const updateFields = { ...req.body };
        delete updateFields.id; // Remove id from update fields

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

        // Invalidate user caches
        await invalidateUserCaches(userId);

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

        const cacheKey = `user_${email || id}`;
        const user = await getOrSetCache(cacheKey, async () => {
            return await User.findOne(conditions, projection).lean();
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur introuvable"
            });
        }

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

        const cacheKey = `all_users_page_${page}_limit_${limit}_search_${searchQuery}`;

        const result = await getOrSetCache(cacheKey, async () => {
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
            return {
                users: aggregateResult.users,
                total
            };
        });

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
        const cacheKey = `user_stats_${userId}`;

        const stats = await getOrSetCache(cacheKey, async () => {
            // Execute queries in parallel for better performance
            const [
                seanceCount,
                topExercises,
                prCount,
                favoriteDayResult,
                totalVolumeResult
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
                    { $sort: { count: -1 } },
                    { $limit: 1 }
                ]),

                // Calculate total volume (sum of all weightLoad)
                SeanceSet.aggregate([
                    { $match: { user: userIdObj } },
                    { $group: { _id: null, total: { $sum: "$weightLoad" } } }
                ])
            ]);

            const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
            const favoriteDay = favoriteDayResult.length > 0
                ? days[favoriteDayResult[0]._id - 1]
                : 'N/A';

            const totalVolume = totalVolumeResult.length > 0
                ? totalVolumeResult[0].total || 0
                : 0;

            return {
                seances: seanceCount,
                topExercices: topExercises,
                prs: prCount,
                favoriteDay: favoriteDay,
                totalVolume: totalVolume
            };
        });

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
        const user = req.body.userId;
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

        //invalidate cache
        await invalidateCacheStartingWith(`notifications_${following}`);
        await invalidateUserCaches(user);
        await invalidateUserCaches(following);

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
        const user = req.body.userId;
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

        //invalidate cache
        await invalidateCacheStartingWith(`notifications_${unfollowing}`);
        await invalidateUserCaches(user);
        await invalidateUserCaches(unfollowing);

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

        const cacheKey = `regularity_score_${userId}`;
        const score = await getOrSetCache(cacheKey, async () => {
            const seances = await Seance.find({ user: userId }).sort({ date: 1 });

            if (seances.length === 0) {
                return { average: 0, currentStreak: 0, bestStreak: 0, uniqueWeeks: 0, totalWeeksSinceFirstWorkout: 0, seances: [] };
            }

            // Week index = weeks since epoch (handles year transitions automatically)
            const getWeekIndex = (date) => Math.floor(date.getTime() / (7 * ONE_DAY));

            const now = new Date();
            const currentWeekIndex = getWeekIndex(now);
            const firstSeanceWeekIndex = getWeekIndex(new Date(seances[0].date));
            const totalWeeksSinceFirstWorkout = currentWeekIndex - firstSeanceWeekIndex + 1;

            // Get unique weeks with workouts (sorted)
            const weekIndices = seances.map(s => getWeekIndex(new Date(s.date)));
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

            // Current streak: count backwards from current/last week
            let currentStreak = 0;
            const lastWorkoutWeek = uniqueWeeks[uniqueWeeks.length - 1];

            // Only count if last workout was this week or last week
            if (lastWorkoutWeek >= currentWeekIndex - 1) {
                currentStreak = 1;
                for (let i = uniqueWeeks.length - 2; i >= 0; i--) {
                    if (uniqueWeeks[i] === uniqueWeeks[i + 1] - 1) {
                        currentStreak++;
                    } else {
                        break;
                    }
                }
            }

            return {
                average,
                uniqueWeeks: uniqueWeeks.length,
                totalWeeksSinceFirstWorkout,
                currentStreak,
                bestStreak,
                lastUpdated: Date.now(),
                seances
            };
        });

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

module.exports = { modifyUser, getUser, getUsers, userStats, followUser, unfollowUser, getRegularityScore, updateLanguage };