const User = require("../schema/schemaUser.js");
const Seance = require("../schema/seance.js");
const SeanceSet = require("../schema/seanceset.js");
const { getOrSetCache, invalidateUserCaches } = require('../controllers/utils/cache');
const mongoose = require('mongoose');
const { getTopExercices } = require('./set');
const { createNotification } = require('./notification');
const Notification = require('../schema/notification');

//COMPTE
async function modifyUser(req, res) {
    let id = req.body.id
    let updated = false;

    let conditions = {
        _id: id
    }

    let update = {}
    if (req.body.profilePic) {
        update = {
            profilePic: req.body.profilePic,
        }
    }
    if (typeof req.body.modeSombre === "string") {
        update = {
            modeSombre: req.body.modeSombre === "true" ? true : false,
        }
    }
    if (req.body.fName && req.body.lName && req.body.email) {
        if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(req.body.email)) {
            res.json({ success: false, message: "Email au mauvais format !" })
        }
        else {
            update = {
                fName: req.body.fName,
                lName: req.body.lName,
                email: req.body.email
            }
        }
    }
    if (req.body.password) {
        updated = true;

        User.findById(req.body.id).then(function (foundUser) {
            if (foundUser) {
                foundUser.setPassword(req.body.password, function () {
                    foundUser.save();
                    res.json({ success: true, message: "Utilisateur mis à jour!" })
                });
            } else {
                res.json({ success: true, message: 'Utilisateur introuvable' });
            }
        }, function (err) {
            console.error(err);
        })
    }

    // else {
    //     console.log("\n no update \n")
    //     console.log(req.body)
    //     res.json({ success: false, message: "Aucune mis à jour!" })
    // }

    if (updated === false) {
        try {
            User.findOneAndUpdate(conditions, update, function (error, result) {
                if (error) {
                    console.log(error)
                }
                else {
                    res.json({ success: true, message: "Utilisateur mis à jour!" })
                }
            });

        }
        catch (e) {
            console.log(e);
        }
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
        if (!req.body.email && !req.body.id) {
            throw new Error("User ID or email is required");
        }

        const conditions = req.body.email ?
            { email: req.body.email } :
            { _id: req.body.id };

        const cacheKey = `user_${conditions.email || conditions._id}`;
        const user = await getOrSetCache(cacheKey, async () => {
            const foundUser = await User.findOne(conditions);
            if (!foundUser) {
                return null;
            }
            return foundUser;
        });

        if (!user) {
            return res.json({
                success: false,
                message: "Utilisateur introuvable !"
            });
        }

        return res.json({
            success: true,
            message: "Utilisateur trouvé !",
            profile: user
        });

    } catch (error) {
        console.error(error);
        return res.json({
            success: false,
            message: error.message
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
        const cacheKey = 'all_users';
        let users = await getOrSetCache(cacheKey, async () => {
            const data = await User.find({});
            if (!data || data.length === 0) {
                return null;
            }
            return data;
        });

        if (!users) {
            return res.json({ success: false, message: "Aucun utilisateur trouvé !" });
        }

        // Sort users by number of seances descending with slight randomization
        const usersWithSeanceCount = await Promise.all(users.map(async user => {
            const seanceCount = await Seance.countDocuments({ user: user._id });
            // Add small random factor between 0-0.5 to maintain rough ordering
            const randomFactor = Math.random() * 0.5;
            return { ...user.toObject(), seanceCount, randomFactor };
        }));
        users = usersWithSeanceCount.sort((a, b) =>
            // Primary sort by seance count, with small random adjustment
            (b.seanceCount + b.randomFactor) - (a.seanceCount + a.randomFactor)
        );

        return res.json({ success: true, message: "Utilisateurs trouvés !", users });

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
            const topExercises = await getTopExercices(user);

            // Get PRs in last 3 months
            const prs = await SeanceSet.countDocuments({
                user: mongoose.Types.ObjectId(user),
                date: { $gte: threeMonthsAgo },
                PR: "PR"
            });

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
                prs: prs,
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
        await createNotification({
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