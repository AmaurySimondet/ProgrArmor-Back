const stringSimilarity = require('string-similarity');

/**
 * @param {string[]} linesToRow - An array of strings where the second element is a date in the format DD/MM/YYYY.
 * @returns {string} - A formatted date string in the format YYYY-MM-DD or "error" if the input date is invalid.
 */
function getDate(linesToRow) {
    // Check if linesToRow has at least 2 elements
    if (linesToRow.length < 2) {
        return "error";
    }

    // Split the date string by '/'
    let date = linesToRow[1].split('/');

    // Check if the date array has 3 parts (DD, MM, YYYY)
    if (date.length < 3) {
        return "error";
    }

    // Check if the year, month, and day have the correct length
    if (date[2].length < 4 || date[1].length < 2 || date[0].length < 2) {
        return "error";
    }

    // Format the date string to YYYY-MM-DD
    date = date[2] + "-" + date[1] + "-" + date[0];

    return date;
}


/**
 * @param {string} string - The string to compare against.
 * @param {{label: string}[]} referencesArray - An array of objects, each with a 'label' property that is a string.
 * @returns {{label: string}} - The reference object with the highest similarity to the input string.
 */
function getBestSimilarity(string, referencesArray) {
    let foundElement = {};
    let max = 0;
    referencesArray.forEach((reference, index) => {
        let similarity = stringSimilarity.compareTwoStrings(reference.label, string);
        if (similarity > max) {
            max = similarity;
            foundElement = reference;
        }
    });
    return foundElement;
}

function getEchauchements(linesToRow, AllExercices, AllMuscles, AllCategories, AllElastiques) {
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

function getExercices(linesToRow, AllExercices, AllMuscles, AllCategories, AllElastiques) {
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

function getDetails(linesToRow, AllDetails) {
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

module.exports = { getDate, getEchauchements, getExercices, getDetails }