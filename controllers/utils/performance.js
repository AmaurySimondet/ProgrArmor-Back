function checkPerformance(seances, exerciceName, muscleName, categoriesList, typeSerieInput, repsTimeInput, percentInput) {
    let check = false;

    seances.forEach((seance, index) => {
        seance.exercices.forEach((exercice, indexExercice) => {
            if (exercice.exercice.name === exerciceName) {

                if (muscleName === "" || exercice.exercice.muscle === muscleName) {

                    let allCategories = [];
                    let checkCategories = false;

                    //check categories
                    if (categoriesList.length > 0 && exercice.Categories && Object.keys(exercice.Categories).length > 0) {
                        Object.values(exercice.Categories).forEach((categorie, indexCategorie) => {
                            allCategories.push(categorie.input);
                        })

                        for (const element of categoriesList) {
                            if (allCategories.includes(element)) {
                                checkCategories = true;
                            }
                        }
                    }
                    if (categoriesList.length === 0) {
                        checkCategories = true;
                    }

                    //check performance
                    if (checkCategories === true) {
                        Object.values(exercice.Series).forEach((serie, indexSerie) => {
                            if (serie.typeSerie === typeSerieInput) {
                                let percentSerie = parseFloat(serie.percent.slice(0, serie.percent.length - 1))
                                let repsTimeSerie = parseFloat(serie.repsTime)

                                if (typeSerieInput === "reps") {
                                    check = _equivalentPercent(repsTimeInput, repsTimeSerie, percentInput, percentSerie);
                                }
                                else if (repsTimeSerie >= repsTimeInput) {
                                    if (percentSerie >= percentInput) {
                                        check = true;
                                    }
                                }
                            }
                        })
                    }
                }
            }
        })
    })

    return check
}

function _equivalentPercent(repsTimeInput, repsTimeSerie, percentInput, percentSerie) {
    let check = false;
    let cent = false;
    const Berger = [
        { rep: 1, percent: 100 },
        { rep: 2, percent: 97.4 },
        { rep: 3, percent: 94.9 },
        { rep: 4, percent: 92.4 },
        { rep: 5, percent: 89.8 },
        { rep: 6, percent: 87.6 },
        { rep: 7, percent: 85.5 },
        { rep: 8, percent: 83.3 },
        { rep: 9, percent: 81.1 },
        { rep: 10, percent: 78.8 },
        { rep: 11, percent: 75 },
        { rep: 12, percent: 72.5 },
        { rep: 13, percent: 70 },
        { rep: 14, percent: 67.5 },
        { rep: 15, percent: 65 },
    ]

    if (repsTimeInput <= 15 && repsTimeInput > 0 && repsTimeSerie <= 15 && repsTimeSerie > 0) {
        if (repsTimeInput !== repsTimeSerie) {

            if (percentInput === 0) {
                percentInput = 100;
                percentSerie += 100;
                cent = true
            }

            let bergerInput = Berger.find(e => e.rep === repsTimeInput).percent; // 94.9%
            let bergerSerie = Berger.find(e => e.rep === repsTimeSerie).percent; // 72.5%

            let conversion = (100 / bergerInput) / 100; // 1.0537

            let convertedBerger = (bergerSerie * conversion); // 0.765
            let convertedObjective = percentInput * convertedBerger; // 114.6%

            if (cent === true) {
                convertedObjective -= 100;
                percentSerie -= 100;
            }

            if (percentSerie >= convertedObjective) {
                check = true;
            }

        }

        else if (repsTimeSerie >= repsTimeInput) {
            if (percentSerie >= percentInput) {
                check = true;
            }
        }
    }

    else if (repsTimeSerie >= repsTimeInput) {
        if (percentSerie >= percentInput) {
            check = true;
        }
    }

    return check;

}

module.exports = { checkPerformance }