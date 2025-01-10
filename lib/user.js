const User = require("../schema/schemaUser.js");
const Seance = require("../schema/seance.js");
const SeanceSet = require("../schema/seanceset.js");
const { getOrSetCache, invalidateUserCaches, invalidateCacheStartingWith } = require('../utils/cache');
const mongoose = require('mongoose');
const { getTopExercices } = require('./set');
const { upsertNotification } = require('./notification');
const Notification = require('../schema/notification');

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

        console.log(req.body);

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

        const cacheKey = `all_users_page_${page}_limit_${limit}`;

        const result = await getOrSetCache(cacheKey, async () => {
            // Use single aggregation for both count and data
            const [aggregateResult] = await User.aggregate([
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
 * Fetches the user's stats.
 * @param {Request} req - The request object.
 * @param {Response} res - The response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
async function userStats(req, res) {
    try {
        if (!req.query.userId) {
            throw new Error("User ID is required");
        }

        const user = req.query.userId;

        // Try to get stats from cache first
        const cacheKey = `user_stats_${user}`;
        const stats = await getOrSetCache(cacheKey, async () => {
            // Get seances from last 3 months
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

            // Count total seances in last 3 months
            const seanceCount = await Seance.countDocuments({
                user: mongoose.Types.ObjectId(user),
                date: { $gte: threeMonthsAgo }
            });

            // Get top exercises based on number of sets
            const topExercises = await getTopExercices(user, null, null, 1, 20);

            // Get PRs in last 3 months
            const prs = await SeanceSet.aggregate([
                {
                    $match: {
                        user: mongoose.Types.ObjectId(user),
                        date: { $gte: threeMonthsAgo },
                        PR: "PR"
                    }
                },
                {
                    $group: {
                        _id: ['$exercice', '$categories.category', '$date'],
                        count: { $sum: 1 }
                    }
                }
            ]);


            // Get favorite day of week
            const favoriteDayAgg = await Seance.aggregate([
                {
                    $match: {
                        user: mongoose.Types.ObjectId(user),
                        date: { $gte: threeMonthsAgo }
                    }
                },
                {
                    $group: {
                        _id: { $dayOfWeek: "$date" },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]);

            const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
            const favoriteDay = favoriteDayAgg.length > 0 ? days[favoriteDayAgg[0]._id - 1] : 'N/A';

            return {
                seances: seanceCount,
                topExercices: topExercises,
                prs: prs.length,
                favoriteDay: favoriteDay
            };
        });

        return res.json({
            success: true,
            stats: stats
        });

    } catch (err) {
        console.error(err);
        return res.json({
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

module.exports = { modifyUser, getUser, getUsers, userStats, followUser, unfollowUser };