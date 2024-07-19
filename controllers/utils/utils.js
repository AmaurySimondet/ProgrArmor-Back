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

function removeEmptyPoids(seance) {
    return (
        Object.fromEntries(Object.entries(seance).filter(([_, element]) => {
            return (element != null && element != [])
        }))
    )
}

function deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;

    if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 == null || obj2 == null) {
        return false;
    }

    let keys1 = Object.keys(obj1);
    let keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (let key of keys1) {
        if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
            return false;
        }
    }

    return true;
}

module.exports = { sortDateCroissant, sortDateDecroissant, seanceChargeSort, seancePercentSort, removeEmpty, removeEmptyPoids, deepEqual }