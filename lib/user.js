const User = require("../schema/schemaUser.js");
const Seance = require("../schema/seance.js");
const SeanceSet = require("../schema/seanceset.js");
const { getOrSetCache, invalidateCacheStartingWith } = require('../controllers/utils/cache');
const mongoose = require('mongoose');
const { getTopExercices } = require('./set');


async function getUserSeancesItems(id) {
    await User.findById(id, (err, user) => {
        if (err) {
            throw new Error("User has no seances")
        }
        else {
            if (user) {
                if (user.seances.length === 0) {
                    throw new Error("User has no seances")
                }
                else {
                    return { success: true, seances: user.seances, checkItems: user.checkItems }
                }
            }
            else {
                throw new Error("User not found")
            }
        }
    })
}

function isAdmin(query) {
    if (query.admin === "true" && query.id === process.env.ADMIN_ID) {
        return {}
    }
    else {
        return { "_id": query.id }
    }
}

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
    let id = req.body.id
    let conditions = { "_id": id }

    if (req.body.email) {
        conditions = { "email": req.body.email }
    }

    try {
        User.find(
            conditions, function (err, data) {
                if (err) {
                    return res.json({ success: false, message: err })
                }
                else {
                    if (data.length === 0) {
                        return res.json({ success: false, message: "Utilisateur introuvable !" })
                    }

                    const obj = {
                        id: data[0]._id,
                        email: data[0].email,
                        fName: data[0].fName,
                        lName: data[0].lName,
                        profilePic: data[0].profilePic,
                    }

                    if (data[0].googleId) {
                        obj.googleId = data[0].googleId
                    }
                    if (data[0].facebookId) {
                        obj.facebookId = data[0].facebookId
                    }
                    if (data[0].modeSombre) {
                        obj.modeSombre = data[0].modeSombre
                    }

                    // console.log(obj)

                    return res.json({ success: true, message: "Utilisateur trouvé !", profile: obj })
                }
            });

    }
    catch (e) {
        console.log(e);
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
        User.find({}, function (err, data) {
            if (err) {
                return res.json({ success: false, message: err })
            }
            else {
                if (data.length === 0) {
                    return res.json({ success: false, message: "Aucun utilisateur trouvé !" })
                }

                const users = []
                data.forEach(user => {
                    const obj = {
                        id: user._id,
                        email: user.email,
                        fName: user.fName,
                        lName: user.lName,
                        profilePic: user.profilePic,
                    }

                    if (user.googleId) {
                        obj.googleId = user.googleId
                    }
                    if (user.facebookId) {
                        obj.facebookId = user.facebookId
                    }
                    if (user.modeSombre) {
                        obj.modeSombre = user.modeSombre
                    }

                    users.push(obj)
                })

                return res.json({ success: true, message: "Utilisateurs trouvés !", users })
            }
        });

    }
    catch (e) {
        console.log(e);
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

        const user = req.query.userId

        // Try to get stats from cache first
        const cacheKey = `user_stats_${user}`;
        const cachedStats = await getOrSetCache(cacheKey, async () => {
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
            stats: cachedStats
        });

    } catch (err) {
        console.error(err);
        return res.json({
            success: false,
            message: "Error fetching user stats"
        });
    }
}

module.exports = { getUserSeancesItems, isAdmin, modifyUser, getUser, getUsers, userStats };