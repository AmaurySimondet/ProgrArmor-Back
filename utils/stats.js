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

module.exports = { seancesToPie }