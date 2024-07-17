const User = require("../../schema/schemaUser.js");
const session = require('cookie-session');
const passport = require("passport");
const express = require("express");
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const stringSimilarity = require('string-similarity');
require('dotenv').config();
const DEV = false;

const url = DEV ? "http://localhost:8800" : "https://www.prograrmor.com"
const url_client = DEV ? "http://localhost:3000" : "https://www.prograrmor.com"

const app = express();

const getUserSeancesItems = require("../utils/user.js").getUserSeancesItems
const checkPerformance = require("../utils/performance.js").checkPerformance

app.use(session({
    secret: process.env.secret,
    keys: [process.env.secret],
    resave: false,
    saveUninitialized: false
}));

// CHANGE: USE "createStrategy" INSTEAD OF "authenticate"
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


//FACEBOOK
const FacebookStrategy = require('passport-facebook').Strategy;

passport.use(new FacebookStrategy({
    proxy: true,
    clientID: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    callbackURL: url + "/user/auth/facebook/authenticate",
    profileFields: ['id', 'name', 'email', 'picture.type(large)']
},
    async (accessToken, refreshToken, profile, done) => {

        const user = {
            facebookId: profile._json.id,
            email: profile._json.email,
            fName: profile._json.first_name,
            lName: profile._json.last_name,
            profilePic: profile._json.picture.data.url
        }

        const oldUser = await User.findOne({ googleId: user.googleId });

        if (oldUser) {
            return done(null, oldUser)
        }
        else {
            const newUser = await new User(user).save();
            return done(null, newUser)
        }
    }
))

async function facebook(req, res) {
    passport.authenticate("facebook", { scope: ['email'] })(req, res, function (err) {
        if (err) {
            console.log(err)
        }
    });
};

async function facebookAuthenticate(req, res) {
    try {
        passport.authenticate("facebook")(req, res, function (err) {
            if (req.user) {
                const token = jwt.sign({ id: req.user._id }, process.env.secret, { expiresIn: "24h" });
                res.redirect(url_client + '/token?token=' + token);
            }
            else {
                console.log(err)
            }
        });
    }
    catch (error) {
        res.send(error);
    }
};

//Google
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
    proxy: true,
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: url + "/user/auth/google/authenticate",
    profileFields: ['id', 'name', 'email', 'photos']
},
    async (accessToken, refreshToken, profile, done) => {

        let user = {}

        if (profile._json.family_name) {
            user = {
                googleId: profile._json.sub,
                email: profile._json.email,
                fName: profile._json.given_name,
                lName: profile._json.family_name,
                profilePic: profile._json.picture
            }
        }
        else {
            user = {
                googleId: profile._json.sub,
                email: profile._json.email,
                fName: profile._json.given_name,
                lName: profile._json.given_name,
                profilePic: profile._json.picture
            }
        }

        const oldUser = await User.findOne({ googleId: user.googleId });

        if (oldUser) {
            return done(null, oldUser)
        }
        else {
            const newUser = await new User(user).save();
            return done(null, newUser)
        }
    }
))

function google(req, res) {
    passport.authenticate("google", { scope: ['email', 'profile'] })(req, res, function (err) {
        if (err) {
            console.log(err)
        }
    });
};

async function googleAuthenticate(req, res) {
    try {
        passport.authenticate("google")(req, res, function (err) {
            if (req.user) {
                const token = jwt.sign({ id: req.user._id }, process.env.secret, { expiresIn: "24h" });
                res.redirect(url_client + '/token?token=' + token);
            }
            else {
                console.log(err)
            }
        });
    }
    catch (error) {
        res.send(error);
    }
};

//Token
function verifyToken(req, res) {
    const token = req.body.token
    jwt.verify(token, process.env.secret, function (err, decoded) {
        if (err) {
            res.json({ success: false, message: "Token verification failed " + err.name });
        }
        else {
            res.json({ success: true, message: "Token verification successfull", id: decoded.id });
        }
    })

}


//SIGNUP
async function signup(req, res) {
    User.register(
        { fName: req.body.fName, email: req.body.email, lName: req.body.lName },
        req.body.password,
        function (err, user) {
            if (err) {
                console.log(err)
                res.json({ success: false, message: "Your account could not be saved. Error: " + err });
            } else {
                passport.authenticate("local")(req, res, function () {
                    const token = jwt.sign({ id: user._id }, process.env.secret, { expiresIn: "24h" });
                    res.json({ success: true, message: "Register successful", token: token });
                });
            };
        });
};


//LOGIN
async function login(req, res) {
    const user = new User({
        email: req.body.email,
        password: req.body.password
    });

    if (!req.body.email) {
        res.json({ success: false, message: "Email was not given" })
    }
    else if (!req.body.password) {
        res.json({ success: false, message: "Password was not given" })
    }

    else {
        req.login(user, function (err) {
            if (err) {
                console.log(err);
            } else {
                passport.authenticate("local", function (err, user, info) {
                    if (err) {
                        res.json({ success: false, message: err });
                    }
                    else {
                        if (!user) {
                            res.json({ success: false, message: "email or password incorrect" });
                        }
                        else {
                            const token = jwt.sign({ id: user._id }, process.env.secret, { expiresIn: "24h" });
                            res.json({ success: true, message: "Register successful", token: token });
                        }
                    }
                })(req, res);
            };
        });
    }
};

//LOGOUT
async function logout(req, res) {
    req.logout(function (err) {
        if (err) { alert(err) }
    });
    res.json({ success: true, message: "Logout successful" })
}

//SESSION
//DEBUTANT FORM
async function debutantform(req, res) {
    let conditions = {
        _id: req.body.id
    }

    let update = {}

    if (req.body.seanceId) {
        console.log("seanceId:", req.body.seanceId);
        console.log("seanceSent:", req.body.seance)

        let seances = [];

        await User.find(conditions, function (err, data) {
            if (err) {
                res.json({ success: false, message: err })
            }
            else {
                seances = [...data[0].seances]

                if (seances.length === 0) {
                    return res.json({ success: false, message: "Aucune séance" })
                }
            }
        })

        if (seances.length !== 0) {
            //newSeance = seance filtered with req.body.seanceId
            newSeances = seances.filter(seance => seance.id !== req.body.seanceId)

            //add seance
            newSeances.push(req.body.seance)

            update = {
                seances: newSeances
            }
        }
        else {
            return res.json({ success: false, message: "Seances non trouvées" })
        }

    }
    else {
        update = {
            $addToSet: { seances: req.body.seance }
        }
    }

    try {
        User.findOneAndUpdate(
            conditions,
            update,
            (err) => {
                if (err) {
                    console.log(err)
                    return res.json({ success: false, message: err })
                }
                else { return res.json({ success: true, message: "Seance enregistrée !" }) }
            }
        )

    }
    catch (e) {
        console.log(e);
    }
};

//LOAD SEANCE
async function loadSeance(req, res) {
    // console.log(req.query);

    function sortDateDecroissant(a, b) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();

    }

    function sortDateCroissant(a, b) {
        return new Date(a.date).getTime() - new Date(b.date).getTime();

    }

    try {
        User.find(
            { "_id": req.query.id }, function (err, data) {
                if (err) {
                    res.json({ success: false, message: err })
                }
                else {
                    let seances = data[0].seances;
                    let seance;

                    if (req.query.load) {
                        if (req.query.load === "lastRec") {
                            seance = seances[seances.length - 1]
                        }

                        if (req.query.load === "lastDate") {
                            seances = seances.sort(sortDateDecroissant);
                            seance = seances[0]
                        }

                        // LastRec seance
                        if (req.query.load[7] === "-") {
                            nomSeance = req.query.load.slice(8, req.query.load.length)

                            seances.forEach((seanceIter, index) => {
                                if (seanceIter.nom) {
                                    if (seanceIter.nom.nouveauNom === nomSeance || seanceIter.nom.ancienNom === nomSeance) {
                                        seance = seanceIter
                                    }
                                }
                            })
                        }

                        // LastDate seance
                        if (req.query.load[8] === "-") {
                            nomSeance = req.query.load.slice(9, req.query.load.length)
                            // console.log(nomSeance)

                            seances = seances.sort(sortDateCroissant);

                            seances.forEach((seanceIter, index) => {
                                if (seanceIter.nom) {
                                    if (seanceIter.nom.nouveauNom === nomSeance || seanceIter.nom.ancienNom === nomSeance) {
                                        seance = seanceIter
                                    }
                                }
                            })
                        }
                    }

                    if (req.query.seanceId) {
                        seance = seances.filter(s => s.id === req.query.seanceId)[0]

                        // console.log(req.query.seanceId, seance)
                    }

                    res.json({ success: true, message: "Utilisateur trouvé !", seance: seance });
                }
            }
        )
    }
    catch (e) {
        console.log(e);
    }

}

//PRISE DE NOTE
async function priseDeNote(req, res) {
    let linesToRow = req.body.note.split('\n');
    let AllExercices = req.body.exercices;
    let AllCategories = req.body.categories;
    let AllDetails = req.body.details;
    let AllMuscles = req.body.muscles;
    let AllElastiques = req.body.elastiques;

    let echauffements = [];
    let details = [];

    function getDate(linesToRow) {
        let date = linesToRow[1].split('/');
        if (date.length < 3) {
            return "error"
        }
        if (date[2].length < 4 || date[1].length < 2 || date[0].length < 2) {
            return "error"
        }
        date = date[2] + "-" + date[1] + "-" + date[0];
        return date
    }

    function getBestSimilarity(string, referencesArray) {
        let foundElement = {};
        let max = 0;
        referencesArray.forEach((reference, index) => {
            let similarity = stringSimilarity.compareTwoStrings(reference.label, string)
            if (similarity > max) {
                max = similarity;
                foundElement = reference;
            }
        })
        return foundElement;
    }

    function getEchauchements(linesToRow) {
        let index = 5;
        let echauffements = [];
        let echauffementNoteLines = [];

        while (linesToRow[index] !== "") {
            echauffementNoteLines.push(linesToRow[index]);
            index++;
        }

        echauffementNoteLines.forEach((e, i) => {
            let echauffement = e.split(':');
            if (echauffement.length < 2) {
                return "error"
            }

            let ExoCat = echauffement[0].split(',');
            let Serie = echauffement[1].split(',');

            echauffement = {
                id: uuidv4(),
                Categories: {},
                Series: {},
                echauffement: {}
            }

            //name & muscle
            if (ExoCat[0].split('-').length > 1) {
                echauffement.echauffement = {
                    name: getBestSimilarity(ExoCat[0].split('-')[0], AllExercices).label,
                    muscle: getBestSimilarity(ExoCat[0].split('-')[1], AllMuscles).label
                }
            }
            //name
            if (ExoCat[0].split('-').length === 1) {
                echauffement.echauffement = {
                    name: getBestSimilarity(ExoCat[0], AllExercices).label
                }
            }

            //categorie
            if (ExoCat.length > 1) {
                ExoCat.forEach((cat, index) => {

                    //elastique
                    if (cat.includes('{')) {
                        let catSplit = cat.split('{')[1].split('}')[0].split(';');

                        let utilisationPossible = ["Resistance", "Assistance"];
                        let utilisation = stringSimilarity.findBestMatch(catSplit[0], utilisationPossible).bestMatch.target;

                        let input = getBestSimilarity(catSplit[1], AllElastiques).value;

                        let tension = parseFloat(catSplit[2].split('=')[1]);

                        let estimation = (tension / 3 * parseInt(input)).toFixed(2)

                        //first index is exerice name
                        if (index !== 0) {

                            if (catSplit[2].includes('tension')) {

                                echauffement.Categories[index - 1] = {
                                    id: uuidv4(),
                                    name: "Elastique",
                                    utilisation: utilisation,
                                    input: input,
                                    tension: tension,
                                    estimation: estimation
                                }
                            }

                            if (catSplit[2].includes('mesure')) {
                                let mesure = parseFloat(catSplit[2].split('=')[1]);

                                echauffement.Categories[index - 1] = {
                                    id: uuidv4(),
                                    name: "Elastique",
                                    utilisation: utilisation,
                                    input: "mesure",
                                    estimation: mesure,
                                }
                            }
                        }
                    }

                    //pas elastique
                    else {
                        let resultElement = getBestSimilarity(cat, AllCategories);
                        //first index is exerice name
                        if (index !== 0) {
                            echauffement.Categories[index - 1] = {
                                id: uuidv4(),
                                name: resultElement.name,
                                input: resultElement.label
                            }
                        }
                    }
                })
            }

            //series
            let nmbreSeries = 0;
            Serie.forEach((serie, index) => {
                let serieSplit = [];

                if (serie.split('[').length > 1) {
                    serieSplit = serie.split('[')[0].split('x');
                    if (serieSplit.length < 3) {
                        return "error"
                    }

                    echauffement.Categories[ExoCat.length] = {
                        id: uuidv4(),
                        name: "Temps de repos entre les séries",
                        input: serie.split('[')[1].split('min]')[0]
                    }
                }
                if (serie.split('[').length === 1) {
                    serieSplit = serie.split('x');
                    if (serieSplit.length < 3) {
                        return "error"
                    }
                }

                let charge = serieSplit[2].replace(' ', '');
                let percent = "" + (parseFloat(charge) / parseFloat(linesToRow[2]) * 100).toFixed(2) + "%"


                if (serieSplit[0] > 1) {
                    for (let i = 0; i < serieSplit[0]; i++) {
                        if (serieSplit[1].includes('sec')) {
                            echauffement.Series[nmbreSeries] = {
                                id: uuidv4(),
                                typeSerie: "time",
                                repsTime: serieSplit[1].split('sec')[0],
                                charge: charge,
                                percent: percent
                            }
                        }
                        else {
                            echauffement.Series[nmbreSeries] = {
                                id: uuidv4(),
                                typeSerie: "reps",
                                repsTime: serieSplit[1],
                                charge: charge,
                                percent: percent
                            }
                        }
                        nmbreSeries++;
                    }
                }
                if (serieSplit[0] === 1) {
                    if (serieSplit[1].includes('sec')) {
                        echauffement.Series[nmbreSeries] = {
                            id: uuidv4(),
                            typeSerie: "time",
                            repsTime: serieSplit[1].split('sec')[0],
                            charge: charge,
                            percent: percent
                        }
                    }
                    else {
                        echauffement.Series[nmbreSeries] = {
                            id: uuidv4(),
                            typeSerie: "reps",
                            repsTime: serieSplit[1],
                            charge: charge,
                            percent: percent
                        }
                    }
                    nmbreSeries++;
                }
            })

            echauffements.push(echauffement)
        })

        return echauffements;
    }

    function getExercices(linesToRow) {
        let index = linesToRow.indexOf("Exercices:") + 1;
        let exercices = [];
        let exerciceNoteLines = [];

        while (linesToRow[index] !== "" && index !== linesToRow.length) {
            exerciceNoteLines.push(linesToRow[index]);
            index++;
        }

        exerciceNoteLines.forEach((e, i) => {
            let exercice = e.split(':');
            if (exercice.length < 2) {
                return "error"
            }
            let ExoCat = exercice[0].split(',');
            let Serie = exercice[1].split(',');

            exercice = {
                id: uuidv4(),
                Categories: {},
                Series: {},
                exercice: {}
            }

            //name & muscle
            if (ExoCat[0].split('-').length > 1) {
                exercice.exercice = {
                    name: getBestSimilarity(ExoCat[0].split('-')[0], AllExercices).label,
                    muscle: getBestSimilarity(ExoCat[0].split('-')[1], AllMuscles).label
                }
            }
            if (ExoCat[0].split('-').length === 1) {
                exercice.exercice = {
                    name: getBestSimilarity(ExoCat[0], AllExercices).label
                }
            }

            //categorie
            if (ExoCat.length > 1) {
                ExoCat.forEach((cat, index) => {

                    //elastique
                    if (cat.includes('{')) {
                        let catSplit = cat.split('{')[1].split('}')[0].split(';');

                        let utilisationPossible = ["Resistance", "Assistance"];
                        let utilisation = stringSimilarity.findBestMatch(catSplit[0], utilisationPossible).bestMatch.target;

                        let input = getBestSimilarity(catSplit[1], AllElastiques).value;

                        let tension = parseFloat(catSplit[2].split('=')[1]);

                        let estimation = (tension / 3 * parseInt(input)).toFixed(2)

                        //first index is exerice name
                        if (index !== 0) {

                            if (catSplit[2].includes('tension')) {

                                exercice.Categories[index - 1] = {
                                    id: uuidv4(),
                                    name: "Elastique",
                                    utilisation: utilisation,
                                    input: input,
                                    tension: tension,
                                    estimation: estimation
                                }
                            }

                            if (catSplit[2].includes('mesure')) {
                                let mesure = parseFloat(catSplit[2].split('=')[1]);

                                exercice.Categories[index - 1] = {
                                    id: uuidv4(),
                                    name: "Elastique",
                                    utilisation: utilisation,
                                    input: "mesure",
                                    estimation: mesure,
                                }
                            }
                        }
                    }

                    //pas elastique
                    else {
                        let resultElement = getBestSimilarity(cat, AllCategories);
                        //first index is exerice name
                        if (index !== 0) {
                            exercice.Categories[index - 1] = {
                                id: uuidv4(),
                                name: resultElement.name,
                                input: resultElement.label
                            }
                        }
                    }
                })
            }

            //series
            let nmbreSeries = 0;
            Serie.forEach((serie, index) => {

                let serieSplit = [];

                if (serie.split('[').length > 1) {
                    serieSplit = serie.split('[')[0].split('x');
                    if (serieSplit.length < 3) {
                        return "error"
                    }

                    exercice.Categories[ExoCat.length] = {
                        id: uuidv4(),
                        name: "Temps de repos entre les séries",
                        input: serie.split('[')[1].split('min]')[0]
                    }
                }
                if (serie.split('[').length === 1) {
                    serieSplit = serie.split('x');
                    if (serieSplit.length < 3) {
                        return "error"
                    }

                }

                let charge = serieSplit[2].replace(' ', '');
                let percent = "" + (parseFloat(charge) / parseFloat(linesToRow[2]) * 100).toFixed(2) + "%"

                if (serieSplit[0] > 1) {
                    for (let i = 0; i < serieSplit[0]; i++) {
                        if (serieSplit[1].includes('sec')) {
                            exercice.Series[nmbreSeries] = {
                                id: uuidv4(),
                                typeSerie: "time",
                                repsTime: serieSplit[1].split('sec')[0],
                                charge: charge,
                                percent: percent
                            }
                        }
                        else {
                            exercice.Series[nmbreSeries] = {
                                id: uuidv4(),
                                typeSerie: "reps",
                                repsTime: serieSplit[1],
                                charge: charge,
                                percent: percent
                            }
                        }
                        nmbreSeries++;
                    }
                }
                else {
                    if (serieSplit[1].includes('sec')) {
                        exercice.Series[nmbreSeries] = {
                            id: uuidv4(),
                            typeSerie: "time",
                            repsTime: serieSplit[1].split('sec')[0],
                            charge: charge,
                            percent: percent
                        }
                    }
                    else {
                        exercice.Series[nmbreSeries] = {
                            id: uuidv4(),
                            typeSerie: "reps",
                            repsTime: serieSplit[1],
                            charge: charge,
                            percent: percent
                        }
                    }
                    nmbreSeries++;
                }
            })

            exercices.push(exercice)
        })

        return exercices;
    }

    function getDetails(linesToRow) {
        let index = linesToRow.indexOf("Details:") + 1;
        let details = [];
        let detailNoteLines = [];

        while (index !== linesToRow.length) {
            detailNoteLines.push(linesToRow[index]);
            index++;
        }

        detailNoteLines.forEach((detail, i) => {

            let detailElement = getBestSimilarity(detail, AllDetails);

            let savedDetail = {
                id: uuidv4(),
                input: detailElement.label,
                name: detailElement.name
            }

            details.push(savedDetail);
        })

        return details;
    }


    try {
        let date = getDate(linesToRow);
        if (date === "error") {
            return res.json({ success: false, message: "Erreur de formalisme de la note (date : jj/mm/aaaa)" })
        }

        if (linesToRow[4] === "Echauffements:") {
            echauffements = getEchauchements(linesToRow);
            if (echauffements === "error") {
                return res.json({ success: false, message: "Erreur de formalisme de la note (échauffements)" })
            }
        }

        if (linesToRow.indexOf("Exercices:") === -1) {
            return res.json({ success: false, message: "Aucun exercice donné !" })
        }
        let exercices = getExercices(linesToRow);
        if (exercices === "error") {
            return res.json({ success: false, message: "Erreur de formalisme de la note (exercices)" })
        }

        if (linesToRow.indexOf("Details:") !== -1) {
            details = getDetails(linesToRow);
        }

        let seance = {
            id: uuidv4(),
            nom: { ancienNom: "nouveau-nom", nouveauNom: linesToRow[0] },
            date: date,
            poids: linesToRow[2],
            echauffements: echauffements,
            exercices: exercices,
            details: details
        }

        // Object.values(seance).forEach((element, index) => {
        //     if (Array.isArray(element)) {
        //         element.forEach((el, i) => {
        //             console.log(el)
        //         })
        //     }
        //     else {
        //         console.log(element)
        //     }
        // })

        return res.json({ success: true, seance: seance })
    }
    catch (error) {
        return res.json({ success: false, message: "Erreur de formalisme de la note" })
    }

}

// exports.editDB2 = (req, res) => {
//     User.updateMany({}, { $set: { checkItems: {} } }, (err) => {
//         if (err) {
//             res.json({ success: false, message: err })
//         }
//         else {
//             res.json({ success: true, message: "Users updated" })
//         }
//     })
// }

//NIVEAU
async function getNiveau(req, res) {
    let seances = [];
    let err = false;
    let checkItems = {};
    let userCheckItems = {};

    await getUserSeancesItems(req.body.id).then((data) => {
        console.log(data)
        seances = data.seances;
        checkItems = data.checkItems;
    }).catch((error) => {
        err = true;
        message = error;
    })

    if (err === true) {
        console.log(message)
        return res.json({ success: false, message: message })
    }

    //INTERMEDIAIRE
    checkItems["statiqueIntermItem1"] = {
        level: "Intermédiaire",
        categorie: "Statique",
        date: new Date(),
        titre: "Front Lever",
        id: "statiqueIntermItem1",
        description: "Tenir un Front Lever One Leg pendant 5 secondes",
        valeur: checkPerformance(seances,
            "Front Lever", ["One leg"], "time", 5, 0, 0)
    }

    checkItems["statiqueIntermItem2"] = {
        level: "Intermédiaire",
        categorie: "Statique",
        date: new Date(),
        titre: "Planche cabossée",
        id: "statiqueIntermItem2",
        description: "Tenir une Tuck Planche 20 secondes ou une Advanced Tuck planche 5 secondes.",
        valeur: checkPerformance(seances,
            "Planche", "", ["Tuck"], "time", 20, 0, 0) || checkPerformance(seances,
                "Planche", ""
                , ["Advanced tuck"], "time", 10, 0)
    }

    checkItems["statiqueIntermItem3"] = {
        level: "Intermédiaire",
        categorie: "Statique",
        date: new Date(),
        titre: "Je m'assoies ainsi",
        id: "statiqueIntermItem3",
        description: "Tenir une L-Sit 15 secondes.",
        valeur: checkPerformance(seances,
            "L Sit", "", [], "time", 15, 0)
    }

    checkItems["statiqueIntermItem4"] = {
        level: "Intermédiaire",
        categorie: "Statique",
        date: new Date(),
        titre: "I'll be back",
        id: "statiqueIntermItem4",
        description: "Avoir un Straddle Back Lever",
        valeur: checkPerformance(seances,
            "Back Lever", "", ["Closed hip straddle"], "time", 1, 0)
    }

    checkItems["pdcIntermItem1"] = {
        level: "Intermédiaire",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Dip",
        id: "pdcIntermItem1",
        description: "Pouvoir exécuter 15 dips",
        valeur: checkPerformance(seances,
            "Dips", "", [], "reps", 15, 0)
    }

    checkItems["pdcIntermItem2"] =
    {
        level: "Intermédiaire",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Tracteur rouillé",
        id: "pdcIntermItem2",
        description: "Pouvoir exécuter 12 tractions complètes ",
        valeur: checkPerformance(seances,
            "Traction / Pull up", "", [], "reps", 12, 0)
    }

    checkItems["pdcIntermItem3"] = {
        level: "Intermédiaire",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Hussle Up",
        id: "pdcIntermItem3",
        description: "Pouvoir exécuter 3 Muscle Up",
        valeur: checkPerformance(seances,
            "Muscle Up", "", [], "reps", 3, 0)
    }

    checkItems["pdcIntermItem4"] = {
        level: "Intermédiaire",
        categorie: "Poids du corps",
        titre: "",
        id: "pdcIntermItem4",
        description: "",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Pompe / Push up", "", ["Archer / Lateral"], 12, 0)
    }

    checkItems["pdcIntermItem5"] = {
        level: "Intermédiaire",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcIntermItem5",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", ['Pistol'], "reps", 5, 0, 0) || checkPerformance(seances,
                "Squat", "", ['Unilatéral'], "reps", 5, 0)
    }

    checkItems["pdcIntermItem6"] = {
        level: "Intermédiaire",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcIntermItem6",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", ['Matrix', "Demi / Half"], "reps", 5, 0) || checkPerformance(seances,
                "Squat", "", ['Matrix', "1/2 haut"], "reps", 5, 0) || checkPerformance(seances,
                    "Extension", "Jambe / Leg", ['Natural'], "reps", 5, 0)
    }

    checkItems["pdcIntermItem7"] = {
        level: "Intermédiaire",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcIntermItem7",
        description: "",
        valeur: checkPerformance(seances,
            "Curl", "Jambe / Leg", ['Nordic', "Hanches très flechies"], "reps", 15, 0) || checkPerformance(seances,
                "Curl", "Jambe / Leg", ['Nordic', "Hanches flechies"], "reps", 15, 0)
    }

    checkItems["streetliftIntermItem1"] = {
        level: "Intermédiaire",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "Complexe de Dip",
        id: "streetliftIntermItem1",
        description: "Pouvoir exécuter 1 Dip à 50% PDC",
        valeur: checkPerformance(seances,
            "Dips", "", [], "reps", 1, 50)
    }

    checkItems["streetliftIntermItem2"] = {
        level: "Intermédiaire",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "Distraction",
        id: "streetliftIntermItem2",
        description: "Pouvoir exécuter 1 traction à 30% PDC ",
        valeur: checkPerformance(seances,
            "Traction / Pull up", "", [], "reps", 1, 30)
    }

    checkItems["streetliftIntermItem4"] = {
        level: "Intermédiaire",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftIntermItem4",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", [], 1, 130)
    }

    checkItems["streetliftIntermItem5"] = {
        level: "Intermédiaire",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftIntermItem5",
        description: "",
        valeur: checkPerformance(seances,
            "Soulevé de terre", "", [], 1, 170)
    }

    checkItems["streetliftIntermItem6"] = {
        level: "Intermédiaire",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftIntermItem6",
        description: "",
        valeur: checkPerformance(seances,
            "Developpé Couché", "", [], 1, 100)
    }

    checkItems["streetliftIntermItem7"] = {
        level: "Intermédiaire",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftIntermItem7",
        description: "",
        valeur: checkPerformance(seances,
            "Hip Thrust", "", [], 1, 200)
    }

    checkItems["equilibreIntermItem1"] = {
        level: "Intermédiaire",
        categorie: "Equilibre",
        titre: "",
        id: "equilibreIntermItem1",
        description: "",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Handstand", "", [], "time", 10, 0)
    }

    checkItems["equilibreIntermItem2"] = {
        level: "Intermédiaire",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreIntermItem2",
        description: "",
        valeur: checkPerformance(seances,
            "Handstand", "", [], "reps", 3, 0)
    }

    checkItems["equilibreIntermItem3"] = {
        level: "Intermédiaire",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreIntermItem3",
        description: "",
        valeur: checkPerformance(seances,
            "Elbow Lever", "", [], "time", 30, 0)
    }


    //CONFIRME

    checkItems["statiqueConfirmeItem1"] = {
        level: "Confirmé",
        categorie: "Statique",
        titre: "Front Fever",
        id: "statiqueConfirmeItem1",
        description: "Tenir un Front Lever pendant 10 secondes",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Front Lever", "", [], "time", 10, 0)
    }

    checkItems["statiqueConfirmeItem2"] = {
        level: "Confirmé",
        categorie: "Statique",
        date: new Date(),
        titre: "Planche à pain",
        id: "statiqueConfirmeItem2",
        description: "Tenir une Closed Hip Straddle Planche pendant 10 secondes",
        valeur: checkPerformance(seances,
            "Planche", "", ["Closed hip straddle"], "time", 10, 0)
    }

    checkItems["statiqueConfirmeItem3"] = {
        level: "Confirmé",
        categorie: "Statique",
        date: new Date(),
        titre: "Patriote",
        id: "statiqueConfirmeItem3",
        description: "Tenir le Drapeau pendant 15 secondes",
        valeur: checkPerformance(seances,
            "Drapeau", "", [], "time", 15, 0)
    }

    checkItems["pdcConfirmeItem1"] = {
        level: "Confirmé",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Diper",
        id: "pdcConfirmeItem1",
        description: "Pouvoir exécuter 10 dips archer",
        valeur: checkPerformance(seances,
            "Dips", "", ["Archer / Lateral"], "reps", 10, 0)
    }

    checkItems["pdcConfirmeItem2"] = {
        level: "Confirmé",
        categorie: "Poids du corps",
        titre: "Tracteur Ford",
        id: "pdcConfirmeItem2",
        description: "Pouvoir exécuter 10 tractions archer ou 1 traction une main ",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Traction / Pull up", "", ["Archer / Lateral"], "reps", 10, 0) || checkPerformance(seances,
                "Traction / Pull up", "", ["Unilatéral"], "reps", 1, 0)
    }

    checkItems["pdcConfirmeItem3"] = {
        level: "Confirmé",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Ma Salope",
        id: "pdcConfirmeItem3",
        description: "Pouvoir exécuter 8 Muscle Up",
        valeur: checkPerformance(seances,
            "Muscle Up", "", [], "reps", 8, 0)
    }

    checkItems["pdcConfirmeItem4"] = {
        level: "Confirmé",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcConfirmeItem4",
        description: "",
        valeur: checkPerformance(seances,
            "Pompe / Push up", "", ["Unilatéral"], 20, 0)
    }

    checkItems["pdcConfirmeItem5"] = {
        level: "Confirmé",
        categorie: "Poids du corps",
        titre: "",
        id: "pdcConfirmeItem5",
        description: "",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Squat", "", ['Pistol'], "reps", 1, 40)
    }

    checkItems["pdcConfirmeItem6"] = {
        level: "Confirmé",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcConfirmeItem6",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", ['Matrix'], "reps", 5, 0)
    }

    checkItems["pdcConfirmeItem7"] = {
        level: "Confirmé",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcConfirmeItem7",
        description: "",
        valeur: checkPerformance(seances,
            "Curl", "Jambe / Leg", ['Nordic', "Hanches flechies"], "reps", 5, 0)
    }

    checkItems["streetliftConfirmeItem1"] = {
        level: "Confirmé",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "Compète de Dips",
        id: "streetliftConfirmeItem1",
        description: "Pouvoir exécuter 1 Dip à 100% PDC",
        valeur: checkPerformance(seances,
            "Dips", "", [], "reps", 1, 100)
    }

    checkItems["streetliftConfirmeItem2"] = {
        level: "Confirmé",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "Contraction",
        id: "streetliftConfirmeItem2",
        description: "Pouvoir exécuter 1 traction à 75% PDC ",
        valeur: checkPerformance(seances,
            "Traction / Pull up", "", [], "reps", 1, 75)
    }

    checkItems["streetliftConfirmeItem4"] = {
        level: "Confirmé",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftConfirmeItem4",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", [], 1, 200)
    }

    checkItems["streetliftConfirmeItem5"] = {
        level: "Confirmé",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftConfirmeItem5",
        description: "",
        valeur: checkPerformance(seances,
            "Soulevé de terre", "", [], 1, 250)
    }

    checkItems["streetliftConfirmeItem6"] = {
        level: "Confirmé",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftConfirmeItem6",
        description: "",
        valeur: checkPerformance(seances,
            "Developpé Couché", "", [], 1, 150)
    }

    checkItems["streetliftConfirmeItem7"] = {
        level: "Confirmé",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftConfirmeItem7",
        description: "",
        valeur: checkPerformance(seances,
            "Hip Thrust", "", [], 1, 300)
    }

    checkItems["equilibreConfirmeItem1"] = {
        level: "Confirmé",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreConfirmeItem1",
        description: "",
        valeur: checkPerformance(seances,
            "Handstand", "", [], "time", 40, 0)
    }

    checkItems["equilibreConfirmeItem2"] = {
        level: "Confirmé",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreConfirmeItem2",
        description: "",
        valeur: checkPerformance(seances,
            "Handstand", "", [], "reps", 5, 0)
    }

    checkItems["equilibreConfirmeItem3"] = {
        level: "Confirmé",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreConfirmeItem3",
        description: "",
        valeur: checkPerformance(seances,
            "Elbow Lever", "", ["Unilatéral"], "time", 30, 0)
    }


    //EXPERT
    checkItems["statiqueExpertItem1"] = {
        level: "Expert",
        categorie: "Statique",
        titre: "Front Forever",
        id: "statiqueExpertItem1",
        description: "Tenir un Front Lever pendant 20 secondes ou un Front Lever à une main",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Front Lever", "", [], "time", 20, 0) || checkPerformance(seances,
                "Front Lever", "", [], ["Unilatéral"], "time", 1, 0)
    }

    checkItems["statiqueExpertItem2"] = {
        level: "Expert",
        categorie: "Statique",
        date: new Date(),
        titre: "Planche à découper",
        id: "statiqueExpertItem2",
        description: "Tenir une Full Planche ou Full Maltest pendant 10 secondes",
        valeur: checkPerformance(seances,
            "Planche", "", [], "time", 10, 0, 0) || checkPerformance(seances,
                "Maltese", "", [], "time", 10, 0)
    }

    checkItems["statiqueExpertItem3"] = {
        level: "Expert",
        categorie: "Statique",
        date: new Date(),
        titre: "Christ rédempteur",
        id: "statiqueExpertItem3",
        description: "Tenir une Iron Cross pendant 10 secondes",
        valeur: checkPerformance(seances,
            "Iron Cross", "", [], "time", 10, 0)
    }

    checkItems["statiqueExpertItem4"] = {
        level: "Expert",
        categorie: "Statique",
        date: new Date(),
        titre: "Hissez haut !",
        id: "statiqueExpertItem4",
        description: "Tenir le Drapeau pendant 30 secondes",
        valeur: checkPerformance(seances,
            "Drapeau", "", [], "time", 30, 0)
    }

    checkItems["pdcExpertItem1"] = {
        level: "Expert",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Dipest",
        id: "pdcExpertItem1",
        description: "Pouvoir exécuter 5 dips à une main",
        valeur: checkPerformance(seances,
            "Dips", "", ["Unilatéral"], "reps", 5, 0)
    }

    checkItems["pdcExpertItem2"] = {
        level: "Expert",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Tracteur Ferrari",
        id: "pdcExpertItem2",
        description: "Pouvoir exécuter 3 traction à une main ",
        valeur: checkPerformance(seances,
            "Traction / Pull up", "", ["Unilatéral"], "reps", 3, 0)
    }

    checkItems["pdcExpertItem3"] = {
        level: "Expert",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "Muslce Up",
        id: "pdcExpertItem3",
        description: "Pouvoir exécuter 12 Muscle Up",
        valeur: checkPerformance(seances,
            "Muscle Up", "", [], "reps", 12, 0)
    }

    checkItems["pdcExpertItem4"] = {
        level: "Expert",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcExpertItem4",
        description: "",
        valeur: checkPerformance(seances,
            "Planche", "", [], "reps", 5, 0)
    }

    checkItems["pdcExpertItem5"] = {
        level: "Expert",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcExpertItem5",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", ['Pistol'], "reps", 1, 60)
    }

    checkItems["pdcExpertItem6"] = {
        level: "Expert",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcExpertItem6",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", ['Matrix'], "reps", 10, 0)
    }

    checkItems["pdcExpertItem7"] = {
        level: "Expert",
        categorie: "Poids du corps",
        date: new Date(),
        titre: "",
        id: "pdcExpertItem7",
        description: "",
        valeur: checkPerformance(seances,
            "Curl", "Jambe / Leg", ['Nordic', "Hanches en extension"], "reps", 1, 0)
    }

    checkItems["streetliftExpertItem1"] = {
        level: "Expert",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "Dip-lômé",
        id: "streetliftExpertItem1",
        description: "Pouvoir exécuter 1 dip à 130% PDC",
        valeur: checkPerformance(seances,
            "Dips", "", [], "reps", 1, 130)
    }

    checkItems["streetliftExpertItem2"] = {
        level: "Expert",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "Decontraction",
        id: "streetliftExpertItem2",
        description: "Pouvoir exécuter 1 traction à 100% PDC ",
        valeur: checkPerformance(seances,
            "Traction / Pull up", "", [], "reps", 1, 100)
    }

    checkItems["streetliftExpertItem4"] = {
        level: "Expert",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftExpertItem4",
        description: "",
        valeur: checkPerformance(seances,
            "Squat", "", [], 1, 230)
    }

    checkItems["streetliftExpertItem5"] = {
        level: "Expert",
        categorie: "Musculation / StreetLifting",
        date: new Date(),
        titre: "",
        id: "streetliftExpertItem5",
        description: "",
        valeur: checkPerformance(seances,
            "Soulevé de terre", "", [], 1, 300)
    }

    checkItems["streetliftExpertItem6"] = {
        level: "Expert",
        categorie: "Musculation / StreetLifting",
        titre: "",
        id: "streetliftExpertItem6",
        description: "",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Developpé Couché", "", [], 1, 200)
    }

    checkItems["streetliftExpertItem7"] = {
        level: "Expert",
        categorie: "Musculation / StreetLifting",
        titre: "",
        id: "streetliftExpertItem7",
        description: "",
        date: new Date(),
        valeur: checkPerformance(seances,
            "Hip Thrust", "", [], 1, 400)
    }

    checkItems["equilibreExpertItem1"] = {
        level: "Expert",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreExpertItem1",
        description: "",
        valeur: checkPerformance(seances,
            "Handstand", "", [], "time", 90, 0)
    }

    checkItems["equilibreExpertItem2"] = {
        level: "Expert",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreExpertItem2",
        description: "",
        valeur: checkPerformance(seances,
            "Handstand", "", [], "reps", 10, 0)
    }

    checkItems["equilibreExpertItem3"] = {
        level: "Expert",
        categorie: "Equilibre",
        date: new Date(),
        titre: "",
        id: "equilibreExpertItem3",
        description: "",
        valeur: checkPerformance(seances,
            "Pompe / Push up", "", ["90° (push-up)"], "reps", 3, 0)
    }

    // console.log(checkItems)
    let same = true;
    if (Object.values(userCheckItems).length > 0) {
        Object.values(checkItems).forEach((item, index) => {
            if (item.valeur !== Object.values(userCheckItems)[index].valeur) {
                same = false;
            }
            if (Object.values(userCheckItems)[index].valeur === true && item.valeur === false) {
                let key = Object.keys(checkItems)[index]
                checkItems[key].valeur = true
            }
        })
    }

    if (same === false && Object.values(userCheckItems).length > 0) {
        console.log("same", same)
        console.log('\n')
        console.log("checkItems", checkItems)
        console.log('\n')
        console.log("userCheckItems", userCheckItems)
        console.log('\n')


        await User.updateOne({ _id: req.body.id }, { $set: { checkItems: checkItems } }, function (err, result) {
            if (err) {
                console.log(err)
            }
        })

        return res.json({ success: true, message: "Niveau", checkItems: checkItems })
    }
    else if (same === true && Object.values(userCheckItems).length > 0) {
        return res.json({ success: true, message: "Niveau", checkItems: checkItems })
    }
    else {
        return res.json({ success: false, message: "Problème de chargement" })
    }






}

//DASHBOARD
//ALL WORKOUTS / ADMIN
async function workouts(req, res) {
    // console.log(req.query)

    function sortDateCroissant(a, b) {
        return new Date(a.date).getTime() - new Date(b.date).getTime();

    }

    function sortDateDecroissant(a, b) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();

    }

    function seanceChargeSort(b, a) {
        const A = parseFloat(a.exercices.map((exercice, indexExercice) => {
            return (Object.values(exercice.Series).map((serie, index) => {
                return serie.charge;
            }))
        }));
        const B = parseFloat(b.exercices.map((exercice, indexExercice) => {
            return (Object.values(exercice.Series).map((serie, index) => {
                return serie.charge;
            }))
        }))
        return A - B;

    }

    function seancePercentSort(b, a) {
        const A = parseFloat(a.exercices.map((exercice, indexExercice) => {
            return (Object.values(exercice.Series).map((serie, index) => {
                return serie.percent.slice(0, serie.percent.length - 1);
            }))
        }));
        const B = parseFloat(b.exercices.map((exercice, indexExercice) => {
            return (Object.values(exercice.Series).map((serie, index) => {
                return serie.percent.slice(0, serie.percent.length - 1);
            }))
        }))
        return A - B;

    }

    function seancesToPerformances(seances, multiple) {
        seances.map((seance, indexSeance) => {
            return (seance.exercices.map((exercice, indexExercice) => {
                return (Object.keys(exercice.Series).map(index => {
                    //                        console.log(seance)
                    //                        console.log(exercice.Series)
                    //                        console.log(Object.keys(exercice.Series))
                    if (multiple) {
                        seances[indexSeance].exercices[indexExercice].Series[index].repsTime = seances[indexSeance].exercices[indexExercice].Series[index].repsTime * multiple
                    }
                    let obj = {}
                    if (seances[indexSeance].exercices[indexExercice].Categories) {
                        obj = {
                            date: seance.date,
                            poids: seance.poids,
                            exercices: [{
                                exercice: {
                                    name: exercice.exercice.name,
                                    ownExercice: exercice.exercice.ownExercice
                                },
                                Series: { 0: seances[indexSeance].exercices[indexExercice].Series[index] },
                                Categories: seances[indexSeance].exercices[indexExercice].Categories
                            }]
                        }
                    }
                    else {
                        obj = {
                            date: seance.date,
                            poids: seance.poids,
                            exercices: [{
                                exercice: {
                                    name: exercice.exercice.name,
                                    ownExercice: exercice.exercice.ownExercice
                                },
                                Series: { 0: seances[indexSeance].exercices[indexExercice].Series[index] }
                            }]
                        }
                    }
                    seances.push(obj);
                    delete seances[indexSeance].exercices[indexExercice].Series[index];
                }))
            }))
        })
        seances.map((seance, indexSeance) => {
            return (seance.exercices.map((exercice, indexExercice) => {
                if (indexExercice > 0) {
                    delete seances[indexSeance].exercices[indexExercice]
                }
            }))
        })
        return seances;
    }

    function removeEmpty(seance) {
        return (
            Object.fromEntries(Object.entries(seance).filter(([_, element]) => {
                if (element[0]) {
                    if (typeof element !== "string") {
                        if (element[0].Series) {
                            return (element[0].Series != null && Object.entries(element[0].Series).length !== 0)
                        }
                    }
                    else { return typeof element === "string" }
                }
            }))
        )
    }

    function seancesToPie(seances, string) {
        let namesList = []
        let sumsList = []

        //seances => namesList = [exercice - muscle, ...] , sumsList = [repsTime, ...]
        seances.map((seance, indexSeance) => {
            return (seance.exercices.map((exercice, indexExercice) => {
                return (Object.keys(exercice.Series).map(index => {
                    if (seances[indexSeance].exercices[indexExercice].Series[index].typeSerie === string || string === "sets") {
                        if (seances[indexSeance].exercices[indexExercice].exercice.muscle) {
                            namesList.push(seances[indexSeance].exercices[indexExercice].exercice.name + " - " + seances[indexSeance].exercices[indexExercice].exercice.muscle)
                            if (string !== "sets") {
                                sumsList.push(parseFloat(seances[indexSeance].exercices[indexExercice].Series[index].repsTime))
                            }
                            else {
                                sumsList.push(0)
                            }
                        }
                        if (seances[indexSeance].exercices[indexExercice].exercice.ownExercice) {
                            namesList.push(seances[indexSeance].exercices[indexExercice].exercice.ownExercice)
                            if (string !== "sets") {
                                sumsList.push(parseFloat(seances[indexSeance].exercices[indexExercice].Series[index].repsTime))
                            }
                            else {
                                sumsList.push(0)
                            }
                        }
                        else {
                            if (!seances[indexSeance].exercices[indexExercice].exercice.muscle) {
                                namesList.push(seances[indexSeance].exercices[indexExercice].exercice.name)
                                if (string !== "sets") {
                                    sumsList.push(parseFloat(seances[indexSeance].exercices[indexExercice].Series[index].repsTime))
                                }
                                else {
                                    sumsList.push(0)
                                }
                            }
                        }
                    }
                }))
            }))
        })

        //reps
        if (string !== "sets") {

            //get rid of null (error)
            let index = []
            sumsList = sumsList.filter(function (el, i) {
                if (isNaN(el)) {
                    index.push(i)
                    return false
                }
                else {
                    return true
                }
            });
            index.forEach((id) => namesList.splice(id, 1))

            //sum the same exercices
            const namesSumsObj = [];

            for (let i = 0; i < namesList.length; i++) {
                const name = namesList[i];
                const sum = sumsList[i];
                let entry = namesSumsObj.find(e => e.name === name);
                if (!entry) {
                    entry = { name: name, repsTime: sum };
                    namesSumsObj.push(entry);
                } else {
                    entry.repsTime += sum;
                }
            }

            return namesSumsObj;
        }
        //sets
        else {
            sumsList = []
            let uniqueNamesList = []

            //count namesList and push into sumsList as they already represents the sets
            for (let k = 0; k < namesList.length; k++) {
                if (!uniqueNamesList.includes(namesList[k])) {
                    uniqueNamesList.push(namesList[k])
                    sumsList.push(namesList.filter(el => { return el === namesList[k] }).length)
                }
            }

            //convert into obj
            let namesSumsObj = []
            for (let k = 0; k < namesList.length; k++) {
                namesSumsObj.push({ name: uniqueNamesList[k], repsTime: parseFloat(sumsList[k]) })
            }

            return namesSumsObj;

        }
    }

    function removeEmptyPoids(seance) {
        return (
            Object.fromEntries(Object.entries(seance).filter(([_, element]) => {
                return (element != null && element != [])
            }))
        )
    }

    function isAdmin(query) {
        if (query.admin === "true" && query.id === process.env.ADMIN_ID) {
            return {}
        }
        else {
            return { "_id": query.id }
        }
    }

    try {
        User.find(
            isAdmin(req.query), function (err, data) {
                if (err) {
                    res.json({ success: false, message: err })
                }

                if (isAdmin(req.query) === { "_id": req.query.id }) {
                    if (!data[0].seances || Object.entries(data[0].seances).length === 0) {
                        res.json({ success: false, message: "Aucune séance !" })
                    }
                }

                let seances = [];
                let ownExercices = [];
                let numUsers = 0;
                let numSeanceDay = 0;
                let numSeances = 0;
                let numActiveUsers = 0;
                if (isAdmin(req.query) === { "_id": req.query.id }) {
                    seances = data[0].seances;
                }
                else {
                    console.log("data", data)
                    numUsers = data.length;
                    let seancesDay = [];
                    data.forEach((user, index) => {
                        if (user.seances.length !== 0) {
                            seances.push(...user.seances)
                            numActiveUsers++;
                        }
                    })
                    seances.forEach((seance, index) => {
                        const todate = new Date();
                        const today = todate.getDate();
                        const tomonth = todate.getMonth() + 1; // getMonth() returns month from 0 to 11
                        const toyear = todate.getFullYear();
                        const date = new Date(seance.date);
                        const day = date.getDate();
                        const month = date.getMonth() + 1; // getMonth() returns month from 0 to 11
                        const year = date.getFullYear();

                        const full = `${day}/${month}/${year}`;
                        const tofull = `${today}/${tomonth}/${toyear}`;

                        if (full === tofull) {
                            seancesDay.push(seance.date)
                        }

                        seance.exercices.forEach((exercice, indexEx) => {
                            if (exercice.exercice.ownExercice !== "" && !ownExercices.includes(exercice.exercice.ownExercice)) {
                                ownExercices.push(exercice.exercice.ownExercice)
                            }
                        })
                    })
                    numSeances = seances.length;
                    numSeanceDay = seancesDay.length
                    console.log("seances", seances)
                }

                //TRI NOM
                if (req.query.nom !== "" && req.query.nom !== "title") {
                    seances.map((seance, indexSeance) => {
                        console.log(seance.nom, req.query.nom)
                        if (seance.nom) {
                            if (seance.nom.ancienNom !== req.query.nom && seance.nom.nouveauNom !== req.query.nom) {
                                delete seances[indexSeance]
                            }
                        }
                        else {
                            delete seances[indexSeance]
                        }
                    })
                }

                //TRI EXERCICE
                seances.map((seance, indexSeance) => {
                    return (seance.exercices.map((exercice, indexExercice) => {
                        if (req.query.exerciceName !== "title" && req.query.exerciceName !== "") {
                            if (req.query.exerciceName !== "own-exercice") {
                                if (req.query.exerciceMuscle !== "" && req.query.exerciceMuscle !== "title") {
                                    if (req.query.exerciceName !== exercice.exercice.name || req.query.exerciceMuscle !== exercice.exercice.muscle) {
                                        delete seances[indexSeance].exercices[indexExercice]
                                    }
                                }
                                else {
                                    if (req.query.exerciceName !== exercice.exercice.name) {
                                        delete seances[indexSeance].exercices[indexExercice]
                                    }
                                }
                            }
                            else {
                                if (req.query.exerciceOwnExercice !== exercice.exercice.ownExercice) {
                                    delete seances[indexSeance].exercices[indexExercice]
                                }
                            }
                        }
                    }))
                })

                //TRI CATEGORIE
                let del = true;
                if (req.query.categorie0name === "Aucune") {
                    seances.map((seance, indexSeance) => {
                        return (seance.exercices.map((exercice, indexExercice) => {
                            if (exercice.Categories && Object.entries(exercice.Categories).length !== 0) {
                                delete delete seances[indexSeance].exercices[indexExercice]
                            }
                        }))
                    })
                }
                else {
                    for (let i = 0; i < 5; i++) {
                        let catName = "categorie" + i + "name";
                        let catInput = "categorie" + i + "input";
                        if (req.query[catName] && req.query[catName] !== "title" && req.query[catName] !== "" && req.query[catName] !== "undefined") {
                            if (req.query[catName] !== "Elastique") {
                                seances.map((seance, indexSeance) => {
                                    return (seance.exercices.map((exercice, indexExercice) => {
                                        if (exercice.Categories && Object.entries(exercice.Categories).length !== 0) {
                                            del = true
                                            Object.values(exercice.Categories).map((categorie, indexCategorie) => {
                                                if (categorie.name === req.query[catName] && categorie.input === req.query[catInput]) {
                                                    del = false
                                                }
                                            })
                                            if (del) {
                                                delete seances[indexSeance].exercices[indexExercice]
                                            }
                                        }
                                        else { delete seances[indexSeance].exercices[indexExercice] }
                                    }))
                                })
                            }
                            else {
                                let catUtilisation = "categorie" + i + "utilisation";
                                seances.map((seance, indexSeance) => {
                                    return (seance.exercices.map((exercice, indexExercice) => {
                                        if (exercice.Categories && Object.entries(exercice.Categories).length !== 0) {
                                            del = true
                                            Object.values(exercice.Categories).map((categorie, indexCategorie) => {
                                                if (categorie.name === req.query[catName] && categorie.utilisation === req.query[catUtilisation]) {
                                                    del = false
                                                }
                                            })
                                            if (del) {
                                                delete seances[indexSeance].exercices[indexExercice]
                                            }
                                        }
                                        else { delete seances[indexSeance].exercices[indexExercice] }
                                    }))
                                })
                            }
                        }
                    }
                }

                //TRI DETAIL
                if (req.query.detail0name === "Aucun") {
                    seances.map((seance, indexSeance) => {
                        if (seance.details && Object.entries(seance.details).length !== 0) {
                            delete seances[indexSeance]
                        }
                    })
                }
                else {
                    for (let i = 0; i < 5; i++) {
                        let catName = "detail" + i + "name";
                        let catInput = "detail" + i + "input";
                        if (req.query[catName] && req.query[catName] !== "title" && req.query[catName] !== "" && req.query[catName] !== "undefined") {
                            seances.map((seance, indexSeance) => {
                                if (seance.details && Object.entries(seance.details).length !== 0) {
                                    del = true
                                    seance.details.map((detail, indexDetail) => {
                                        if (detail.name === req.query[catName] && detail.input === req.query[catInput]) {
                                            del = false
                                        }
                                    })
                                    if (del) {
                                        delete seances[indexSeance]
                                    }
                                }
                                else { delete seances[indexSeance] }
                            })
                        }
                    }
                }

                //TRI REP RANGE
                if (req.query.repsFrom !== "") {
                    seances.map((seance, indexSeance) => {
                        return (seance.exercices.map((exercice, indexExercice) => {
                            return (Object.values(exercice.Series).map((serie, index) => {
                                if (parseFloat(serie.repsTime) < req.query.repsFrom) {
                                    delete seances[indexSeance].exercices[indexExercice].Series[index]
                                }
                            }))
                        }))
                    })
                }
                if (req.query.repsTo !== "") {
                    seances.map((seance, indexSeance) => {
                        return (seance.exercices.map((exercice, indexExercice) => {
                            return (Object.values(exercice.Series).map((serie, index) => {
                                if (parseFloat(serie.repsTime) > req.query.repsTo) {
                                    delete seances[indexSeance].exercices[indexExercice].Series[index]
                                }
                            }))
                        }))
                    })
                }

                //TRI PERIODE
                let currDate = new Date();
                if (req.query.periode === '7d') {
                    seances.map((seance, indexSeance) => {
                        let d2 = new Date(seance.date);
                        if (Math.floor((currDate - d2) / 1000 / 60 / 60 / 24) > 7) {
                            delete seances[indexSeance]
                        }
                    })
                }
                if (req.query.periode === '30d') {
                    seances.map((seance, indexSeance) => {
                        let d2 = new Date(seance.date);
                        if (Math.floor((currDate - d2) / 1000 / 60 / 60 / 24) > 30) {
                            delete seances[indexSeance]
                        }
                    })
                }
                if (req.query.periode === '90d') {
                    seances.map((seance, indexSeance) => {
                        let d2 = new Date(seance.date);
                        if (Math.floor((currDate - d2) / 1000 / 60 / 60 / 24) > 90) {
                            delete seances[indexSeance]
                        }
                    })
                }
                if (req.query.periode === '180d') {
                    seances.map((seance, indexSeance) => {
                        let d2 = new Date(seance.date);
                        if (Math.floor((currDate - d2) / 1000 / 60 / 60 / 24) > 180) {
                            delete seances[indexSeance]
                        }
                    })
                }
                if (req.query.periode === '1y') {
                    seances.map((seance, indexSeance) => {
                        let d2 = new Date(seance.date);
                        if (Math.floor((currDate - d2) / 1000 / 60 / 60 / 24) > 365) {
                            delete seances[indexSeance]
                        }
                    })
                }

                //TRI TYPE TRI
                if (req.query.tri === 'Ordre chronologique décroissant') {
                    seances = seances.sort(sortDateDecroissant);

                }
                if (req.query.tri === 'Ordre chronologique croissant') {
                    seances = seances.sort(sortDateCroissant);

                }
                if (req.query.tri === 'Charge (ordre décroissant)') {
                    seances = seancesToPerformances(seances);
                    seances = seances.sort(seanceChargeSort);

                }
                if (req.query.tri === 'PDC (ordre décroissant)') {
                    seances = seancesToPerformances(seances);
                    seances = seances.sort(seancePercentSort);

                }

                //STATS REFORME
                let percentMax = 0;
                let chargeMax = 0;
                if (req.query.reforme === "true") {
                    let arr = []
                    seances.forEach(seance => {
                        arr.push(removeEmpty(seance))
                    });

                    //to perf
                    seances = seancesToPerformances(seances, 10);

                    //nettoyage
                    arr = []
                    seances.forEach(seance => {
                        arr.push(removeEmpty(seance))
                    });
                    seances = arr.filter(seance => {
                        return (Object.entries(seance).length !== 0 && seance.exercices)
                    });

                    //percent en float et recuperation chargemax percentmax
                    arr = []
                    let arr2 = []
                    seances.forEach(seance => {
                        seance.exercices[0].Series[0].percent = parseFloat(seance.exercices[0].Series[0].percent);
                        arr.push(parseFloat(seance.exercices[0].Series[0].percent))
                        arr2.push(parseFloat(seance.exercices[0].Series[0].charge))
                    });
                    chargeMax = Math.max(...arr2)
                    percentMax = Math.max(...arr)

                    //elastique en float
                    seances.forEach(seance => {
                        for (let k = 0; k < 5; k++) {
                            if (seance.exercices[0].Categories && seance.exercices[0].Categories[k] && seance.exercices[0].Categories[k].estimation) {
                                seance.exercices[0].Categories[k].estimation = parseFloat(seance.exercices[0].Categories[k].estimation);
                                if (seance.exercices[0].Categories[k].utilisation === "Resistance") {
                                    seance.exercices[0].Categories[k].resistance = parseFloat(seance.exercices[0].Categories[k].estimation)
                                }
                                if (seance.exercices[0].Categories[k].utilisation === "Assistance") {
                                    seance.exercices[0].Categories[k].assistance = parseFloat(seance.exercices[0].Categories[k].estimation)
                                }
                            }
                        }
                    });

                }

                //format date
                if (req.query.date === "md") {
                    seances.forEach(seance => {
                        seance.date = seance.date.slice(5, seance.date.length)
                    });
                }
                if (req.query.date === "d") {
                    seances.forEach(seance => {
                        seance.date = seance.date.slice(seance.date.length - 2, seance.date.length)
                    });
                }

                //STATS REFORME poids
                let poidsMax = 0;
                let poidsMin = 0;
                if (req.query.reforme === "poids") {
                    let arr = []
                    seances.forEach(seance => {
                        arr.push(removeEmptyPoids(seance))
                    });

                    seances = arr.filter(element => {
                        return Object.entries(element).length !== 0
                    });

                    arr = []
                    seances.forEach((seance) => { arr.push(parseFloat(seance.poids)) })
                    poidsMax = Math.max(...arr)
                    poidsMin = Math.min(...arr)
                }

                //STATS REFORME poids
                if (req.query.reforme === "pie") {
                    seances = seancesToPie(seances, req.query.class)
                    seances = seances.sort((a, b) => { return b.repsTime - a.repsTime })
                    seances.forEach((seance) => {
                        seance.class = req.query.class
                    })
                }

                res.json({
                    success: true, message: "Utilisateur trouvé !",
                    seances: seances, numSeanceDay: numSeanceDay,
                    numUsers: numUsers, numSeances: numSeances,
                    numActiveUsers: numActiveUsers, ownExercices: ownExercices,
                    poidsMax: poidsMax, poidsMin: poidsMin, chargeMax: chargeMax,
                    percentMax: percentMax
                })

            });

    }
    catch (e) {
        console.log(e);
    }
};

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

//RESET PASSWORD
async function resetPassword(req, res) {
    let conditions = {
        email: req.body.email
    }

    try {
        User.findOne(conditions).then(function (foundUser) {
            if (foundUser) {
                // console.log(foundUser)
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
    catch (e) {
        console.log(e);
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

//SUPPR SEANCE
async function supprSeance(req, res) {
    let conditions = {}
    let update = {}
    let newSeances = [];
    let seances = []

    conditions = {
        _id: req.body.id
    }

    //find user seances
    await User.find(conditions, function (err, data) {
        if (err) {
            res.json({ success: false, message: err })
        }
        else {
            seances = [...data[0].seances]

            if (seances.length === 0) {
                res.json({ success: false, message: "Aucune séance" })
            }
        }
    })


    if (seances.length !== 0) {
        console.log("DEL_ID: ", req.body.seanceId)
        seances.forEach((seance) => console.log(seance.id))

        //newSeance = seance filtered with req.body.seanceId
        newSeances = seances.filter(seance => seance.id !== req.body.seanceId)

        update = {
            seances: newSeances
        }

        console.log("newSeances :", newSeances)

        // if (newSeances.length === 0) {
        //     res.json({ success: false, message: "Toutes les séances seront supprimées !" })
        // }

        //update seances user
        User.findOneAndUpdate(conditions, update, function (error, result) {
            if (error) {
                res.json({ success: false, message: error })
            }
            else {
                res.json({ success: true, message: "Seance supprimée !" })
            }
        });
    }
    else {
        res.json({ success: false, message: "Seances non trouvées" })
    }
}

//REGU SCORE
async function reguScore(req, res) {
    let conditions = {}
    let seances = []
    let error = null;

    conditions = {
        _id: req.body.id
    }

    //find user seances
    await User.find(conditions, function (err, data) {
        if (err) {
            error = { success: false, message: err }
        }
        else {
            seances = [...data[0].seances]

            if (seances.length === 0) {
                error = { success: false, message: "Aucune séance" }
            }
        }
    })

    if (error !== null) {
        return res.json(error)
    }

    if (seances.length > 1) {
        Date.prototype.getWeek = function (dowOffset) {
            /*getWeek() was developed by Nick Baicoianu at MeanFreePath: http://www.meanfreepath.com */

            dowOffset = typeof (dowOffset) == 'number' ? dowOffset : 0; //default dowOffset to zero
            var newYear = new Date(this.getFullYear(), 0, 1);
            var day = newYear.getDay() - dowOffset; //the day of week the year begins on
            day = (day >= 0 ? day : day + 7);
            var daynum = Math.floor((this.getTime() - newYear.getTime() -
                (this.getTimezoneOffset() - newYear.getTimezoneOffset()) * 60000) / 86400000) + 1;
            var weeknum;
            //if the year starts before the middle of a week
            if (day < 4) {
                weeknum = Math.floor((daynum + day - 1) / 7) + 1;
                if (weeknum > 52) {
                    nYear = new Date(this.getFullYear() + 1, 0, 1);
                    nday = nYear.getDay() - dowOffset;
                    nday = nday >= 0 ? nday : nday + 7;
                    /*if the next year starts before the middle of
                      the week, it is week #1 of that year*/
                    weeknum = nday < 4 ? 1 : 53;
                }
            }
            else {
                weeknum = Math.floor((daynum + day - 1) / 7);
            }
            return weeknum;
        };

        let reguScore = [
            {
                name: 'Score',
                score: 80
            }
        ]

        weekAndYear = [];

        seances.forEach(s => {
            date = new Date(s.date)
            weekAndYear.push({ id: uuidv4(), week: date.getWeek(), year: date.getFullYear() })
        });

        function sortWeekCroissant(a, b) {
            return a.week - b.week
        }

        function sortYearCroissant(a, b) {
            return a.year - b.year
        }

        weekAndYear = weekAndYear.sort(sortWeekCroissant);
        weekAndYear = weekAndYear.sort(sortYearCroissant);

        let lastS = weekAndYear[weekAndYear.length - 1];
        let firstS = weekAndYear[0];

        // 42/2021 13/2022
        let weeksDiff = lastS.week - firstS.week; // 13 - 42 = -29
        let yearsDiff = lastS.year - firstS.year; // 2022 - 2021 = 1

        let weeksOverPeriod = yearsDiff * 52 + weeksDiff

        let seancesOnWeeks = (seances.length + 1) / weeksOverPeriod

        let consecutivePeriods = [];
        let consecutiveSeances = 1;
        for (let k = 0; k < weekAndYear.length - 1; k++) {
            let S1 = weekAndYear[k];
            let S2 = weekAndYear[k + 1];
            let bool = false

            if ((S2.week === (S1.week + 1) || S2.week === S1.week) && S2.year === S1.year) {
                consecutiveSeances++;
                bool = true
            }
            if (bool === false || k === weekAndYear.length - 2) {
                consecutivePeriods.push(consecutiveSeances);
                consecutiveSeances = 1;
            }
        }

        //série actuelle
        currDate = new Date();
        currDate = { id: uuidv4(), week: currDate.getWeek(), year: currDate.getFullYear() }
        if (lastS.week === currDate.week && lastS.year === currDate.year) {
            currSerie = consecutivePeriods[consecutivePeriods.length - 1];
        }
        else {
            currSerie = 1;
        }

        const average = array => array.reduce((a, b) => a + b) / array.length;

        // console.log("seanceOnWeeks:", seancesOnWeeks)
        // console.log("consecutivePeriods:", consecutivePeriods)
        // console.log("avg(consPeriods)/weeksOvPeriod", average(consecutivePeriods) / weeksOverPeriod)
        // console.log("consecutivePeriodsLength/LengthMax", consecutivePeriods.length / (weeksOverPeriod / 2))

        //meilleur cas: seanceOnWeeks >= 1, consecutivePeriods = [ >= weeksOverPeriod ]
        //pire cas: seanceOnWeeks ~= 0, consecutivePeriods = [ 1 / weeksOverPeriod, ~0, ...][weeksOverPeriod / 2]

        let score = (seancesOnWeeks + (average(consecutivePeriods) / weeksOverPeriod) + (consecutivePeriods.length / (weeksOverPeriod / 2))) / 3 * 100
        // console.log("score:", score)

        if (score >= 100) {
            reguScore[0].score = 100
        }
        else {
            reguScore[0].score = score
        }

        res.json({
            success: true, message: "Seances trouvées", reguScore: reguScore, bestSerie: Math.max(...consecutivePeriods),
            AverageSerie: average(consecutivePeriods), currSerie: currSerie
        })
    }
    else {
        res.json({ success: false, message: "Seances non trouvées" })
    }
}

//EDIT DB
// async function editDB(req, res) {

//     let idAndSeances = [];

//     //get user id and seances
//     await User.find(
//         {}, function (err, data) {
//             if (err) {
//                 res.json({ success: false, message: err })
//             }
//             else {

//                 data.forEach((user) => {
//                     if (user.seances.length !== 0) {
//                         idAndSeances.push({ userID: user._id, userSeances: [...user.seances] })
//                     }
//                 })
//             }
//         })

//     //ajouter les id partout ou il faut
//     function addIdtoAll(idAndSeances) {

//         let addedIdtoAll = [...idAndSeances];

//         addedIdtoAll.forEach((userIdAndUserSeance, indexObj) => {
//             userIdAndUserSeance.userSeances.forEach((seance, indexSeance) => {

//                 //Seance
//                 addedIdtoAll[indexObj].userSeances[indexSeance] = { ...seance, id: uuidv4() }

//                 //Echauffements
//                 if (seance.echauffements && seance.echauffements.length > 0) {
//                     seance.echauffements.forEach((echauffement, indexEchauffement) => {
//                         //Echauffements
//                         addedIdtoAll[indexObj].userSeances[indexSeance].echauffements[indexEchauffement] = { ...echauffement, id: uuidv4() }

//                         //Series
//                         for (let k = 0; k < Object.values(echauffement.Series).length; k++) {
//                             addedIdtoAll[indexObj].userSeances[indexSeance].echauffements[indexEchauffement].Series[k] = { ...echauffement.Series[k], id: uuidv4() }
//                         }

//                         //Categories
//                         if (echauffement.Categories) {
//                             for (let k = 0; k < Object.values(echauffement.Categories).length; k++) {
//                                 addedIdtoAll[indexObj].userSeances[indexSeance].echauffements[indexEchauffement].Categories[k] = { ...echauffement.Categories[k], id: uuidv4() }
//                             }
//                         }
//                     })
//                 }

//                 //Exercices
//                 seance.exercices.forEach((exercice, indexExercice) => {
//                     //Echauffements
//                     addedIdtoAll[indexObj].userSeances[indexSeance].exercices[indexExercice] = { ...exercice, id: uuidv4() }

//                     //Series
//                     for (let k = 0; k < Object.values(exercice.Series).length; k++) {
//                         addedIdtoAll[indexObj].userSeances[indexSeance].exercices[indexExercice].Series[k] = { ...exercice.Series[k], id: uuidv4() }
//                     }

//                     //Categories
//                     if (exercice.Categories) {
//                         for (let k = 0; k < Object.values(exercice.Categories).length; k++) {
//                             addedIdtoAll[indexObj].userSeances[indexSeance].exercices[indexExercice].Categories[k] = { ...exercice.Categories[k], id: uuidv4() }
//                         }
//                     }
//                 })

//                 //Details
//                 if (seance.details && seance.details.length > 0) {
//                     seance.details.forEach((detail, indexDetail) => {
//                         addedIdtoAll[indexObj].userSeances[indexSeance].details[indexDetail] = { ...detail, id: uuidv4 }
//                     })
//                 }

//             })
//         })

//         return addedIdtoAll
//     }
//     let addedIdtoAll = addIdtoAll(idAndSeances);


//     let conditions = {}
//     let update = {}

//     //for user id update user seance
//     addedIdtoAll.forEach((userIdAndUserSeance) => {

//         conditions = {
//             _id: userIdAndUserSeance.userID
//         }

//         update = {
//             seances: userIdAndUserSeance.userSeances
//         }

//         User.findOneAndUpdate(conditions, update, function (error, result) {
//             if (error) {
//                 res.json({ success: false, message: error })
//             }
//         });
//     })


//     res.json({ success: true, message: "DB modifiée !" })

// }

//On exporte nos fonctions
exports.login = login;
exports.signup = signup;
exports.facebook = facebook;
exports.facebookAuthenticate = facebookAuthenticate;
exports.google = google;
exports.googleAuthenticate = googleAuthenticate;
exports.logout = logout;
exports.debutantform = debutantform;
exports.workouts = workouts;
exports.getUser = getUser;
exports.verifyToken = verifyToken;
exports.supprSeance = supprSeance;
exports.modifyUser = modifyUser;
exports.loadSeance = loadSeance;
// exports.editDB = editDB;
exports.reguScore = reguScore;
exports.priseDeNote = priseDeNote;
exports.resetPassword = resetPassword;
exports.getNiveau = getNiveau;