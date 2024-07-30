const User = require("../../schema/schemaUser.js");
const { v4: uuidv4 } = require('uuid');

const getUserSeancesItems = require("../utils/user.js").getUserSeancesItems
const getDate = require("../utils/libPriseDeNote.js").getDate
const getEchauchements = require("../utils/libPriseDeNote.js").getEchauchements
const getExercices = require("../utils/libPriseDeNote.js").getExercices
const getDetails = require("../utils/libPriseDeNote.js").getDetails
const getCheckItems = require("../utils/checkItems.js").getCheckItems
const seancesToPerformances = require("../utils/performance.js").seancesToPerformances
const sortDateCroissant = require("../utils/utils.js").sortDateCroissant
const sortDateDecroissant = require("../utils/utils.js").sortDateDecroissant
const seanceChargeSort = require("../utils/utils.js").seanceChargeSort
const seancePercentSort = require("../utils/utils.js").seancePercentSort
const removeEmpty = require("../utils/utils.js").removeEmpty
const removeEmptyPoids = require("../utils/utils.js").removeEmptyPoids
const deepEqual = require("../utils/utils.js").deepEqual
const seancesToPie = require("../utils/stats.js").seancesToPie
const isAdmin = require("../utils/user.js").isAdmin


//SESSION
//DEBUTANT FORM
async function debutantform(req, res) {
    let conditions = {
        _id: req.body.id
    }

    let update = {}

    if (req.body.seanceId) {

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


    try {
        let date = getDate(linesToRow);
        if (date === "error") {
            return res.json({ success: false, message: "Erreur de formalisme de la note (date : jj/mm/aaaa)" })
        }

        if (linesToRow[4] === "Echauffements:") {
            echauffements = getEchauchements(linesToRow, AllExercices, AllCategories, AllMuscles, AllElastiques);
            if (echauffements === "error") {
                return res.json({ success: false, message: "Erreur de formalisme de la note (échauffements)" })
            }
        }

        if (linesToRow.indexOf("Exercices:") === -1) {
            return res.json({ success: false, message: "Aucun exercice donné !" })
        }
        let exercices = getExercices(linesToRow, AllExercices, AllCategories, AllMuscles, AllElastiques);
        if (exercices === "error") {
            return res.json({ success: false, message: "Erreur de formalisme de la note (exercices)" })
        }

        if (linesToRow.indexOf("Details:") !== -1) {
            details = getDetails(linesToRow, AllDetails);
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

//NIVEAU
async function getNiveau(req, res) {
    let seances = [];
    let err = false;
    let userCheckItems = {};

    await getUserSeancesItems(req.body.id).then((data) => {
        seances = data.seances;
        checkItems = data.checkItems;
    }).catch((error) => {
        err = true;
        message = error;
    })

    let checkItems = getCheckItems(seances);

    if (err === true) {
        return res.json({ success: false, message: message })
    }

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
    try {
        User.find(isAdmin(req.query), function (err, data) {
            if (err) {
                return res.json({ success: false, message: err });
            }

            if (deepEqual(isAdmin(req.query), { "_id": req.query.id })) {
                if (!data[0].seances || data[0].seances.length === 0) {
                    return res.json({ success: false, message: "Aucune séance !" });
                }
            }

            let seances = [];
            let ownExercices = [];
            let numUsers = 0;
            let numSeanceDay = 0;
            let numSeances = 0;
            let numActiveUsers = 0;

            if (deepEqual(isAdmin(req.query), { "_id": req.query.id })) {
                if (data[0].seances && data[0].seances.length !== 0) {
                    seances = data[0].seances;
                } else {
                    return res.json({ success: true, message: "Utilisateur trouvé !" });
                }
            }
            else {
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
            }

            //TRI NOM
            if (req.query.nom !== "" && req.query.nom !== "title") {
                seances.map((seance, indexSeance) => {
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
        seances.forEach((seance) => console.log(seance.id))

        //newSeance = seance filtered with req.body.seanceId
        newSeances = seances.filter(seance => seance.id !== req.body.seanceId)

        update = {
            seances: newSeances
        }

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

//On exporte nos fonctions
exports.debutantform = debutantform;
exports.workouts = workouts;
exports.supprSeance = supprSeance;
exports.loadSeance = loadSeance;
exports.reguScore = reguScore;
exports.priseDeNote = priseDeNote;
exports.getNiveau = getNiveau;