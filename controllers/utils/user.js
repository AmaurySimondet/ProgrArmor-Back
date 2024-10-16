const User = require("../../schema/schemaUser.js");

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
                    res.json({ success: false, message: err })
                }
                else {
                    if (data.length === 0) {
                        res.json({ success: false, message: "Utilisateur introuvable !" })
                    }
                    else {
                        const obj = {
                            id: data[0]._id,
                            email: data[0].email,
                            fName: data[0].fName,
                            lName: data[0].lName,
                            profilePic: data[0].profilePic,
                            seances: data[0].seances,
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

                        res.json({ success: true, message: "Utilisateur trouvé !", profile: obj, seances: data[0].seances })
                    }
                }
            });

    }
    catch (e) {
        console.log(e);
    }
}

module.exports = { getUserSeancesItems, isAdmin, modifyUser, getUser }