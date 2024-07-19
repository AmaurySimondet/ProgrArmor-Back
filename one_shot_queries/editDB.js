// EDIT DB
async function editDB(req, res) {

    let idAndSeances = [];

    //get user id and seances
    await User.find(
        {}, function (err, data) {
            if (err) {
                res.json({ success: false, message: err })
            }
            else {

                data.forEach((user) => {
                    if (user.seances.length !== 0) {
                        idAndSeances.push({ userID: user._id, userSeances: [...user.seances] })
                    }
                })
            }
        })

    //ajouter les id partout ou il faut
    function addIdtoAll(idAndSeances) {

        let addedIdtoAll = [...idAndSeances];

        addedIdtoAll.forEach((userIdAndUserSeance, indexObj) => {
            userIdAndUserSeance.userSeances.forEach((seance, indexSeance) => {

                //Seance
                addedIdtoAll[indexObj].userSeances[indexSeance] = { ...seance, id: uuidv4() }

                //Echauffements
                if (seance.echauffements && seance.echauffements.length > 0) {
                    seance.echauffements.forEach((echauffement, indexEchauffement) => {
                        //Echauffements
                        addedIdtoAll[indexObj].userSeances[indexSeance].echauffements[indexEchauffement] = { ...echauffement, id: uuidv4() }

                        //Series
                        for (let k = 0; k < Object.values(echauffement.Series).length; k++) {
                            addedIdtoAll[indexObj].userSeances[indexSeance].echauffements[indexEchauffement].Series[k] = { ...echauffement.Series[k], id: uuidv4() }
                        }

                        //Categories
                        if (echauffement.Categories) {
                            for (let k = 0; k < Object.values(echauffement.Categories).length; k++) {
                                addedIdtoAll[indexObj].userSeances[indexSeance].echauffements[indexEchauffement].Categories[k] = { ...echauffement.Categories[k], id: uuidv4() }
                            }
                        }
                    })
                }

                //Exercices
                seance.exercices.forEach((exercice, indexExercice) => {
                    //Echauffements
                    addedIdtoAll[indexObj].userSeances[indexSeance].exercices[indexExercice] = { ...exercice, id: uuidv4() }

                    //Series
                    for (let k = 0; k < Object.values(exercice.Series).length; k++) {
                        addedIdtoAll[indexObj].userSeances[indexSeance].exercices[indexExercice].Series[k] = { ...exercice.Series[k], id: uuidv4() }
                    }

                    //Categories
                    if (exercice.Categories) {
                        for (let k = 0; k < Object.values(exercice.Categories).length; k++) {
                            addedIdtoAll[indexObj].userSeances[indexSeance].exercices[indexExercice].Categories[k] = { ...exercice.Categories[k], id: uuidv4() }
                        }
                    }
                })

                //Details
                if (seance.details && seance.details.length > 0) {
                    seance.details.forEach((detail, indexDetail) => {
                        addedIdtoAll[indexObj].userSeances[indexSeance].details[indexDetail] = { ...detail, id: uuidv4 }
                    })
                }

            })
        })

        return addedIdtoAll
    }
    let addedIdtoAll = addIdtoAll(idAndSeances);


    let conditions = {}
    let update = {}

    //for user id update user seance
    addedIdtoAll.forEach((userIdAndUserSeance) => {

        conditions = {
            _id: userIdAndUserSeance.userID
        }

        update = {
            seances: userIdAndUserSeance.userSeances
        }

        User.findOneAndUpdate(conditions, update, function (error, result) {
            if (error) {
                res.json({ success: false, message: error })
            }
        });
    })


    res.json({ success: true, message: "DB modifiée !" })

}


exports.editDB2 = (req, res) => {
    User.updateMany({}, { $set: { checkItems: {} } }, (err) => {
        if (err) {
            res.json({ success: false, message: err })
        }
        else {
            res.json({ success: true, message: "Users updated" })
        }
    })
}

module.exports = { editDB: editDB, editDB2: editDB2 }