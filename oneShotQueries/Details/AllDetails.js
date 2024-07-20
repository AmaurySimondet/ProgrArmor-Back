const Courbatures = require('./Courbatures');
const Fatigue = require('./Fatigue');
const Meteo = require('./Meteo');
const DouleurSeance = require('./DouleurSeance');
const DRUG = require('./DRUG');
const Environnement = require('./Environnement');
const Preworkout = require('./Preworkout');
const Psycho = require('./Psycho');
const Seul = require('./Seul');

let AllDetails = []


AllDetails.push({
    id: "name",
    className: "select-title",
    label: "Tous (défaut)",
    value: "title",
},



    {
        id: "name",
        className: "select-title",
        label: "",
        value: "title",
    },
    {
        id: "name",
        className: "select-title",
        label: "Aucun",
        value: "title",
    },
    {
        id: "name",
        className: "select-item",
        label: "Aucun",
        value: "Aucun",
    },




    {
        id: "name",
        className: "select-title",
        label: "",
        value: "title",
    },
    {
        id: "name",
        className: "select-title",
        label: "Courbatures / Congestion",
        value: "title",
    })
Courbatures.forEach(obj => {
    AllDetails.push({ ...obj, name: "Courbatures / Congestion" });
    obj.name = "Courbatures / Congestion"
})




AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Condition météorologique défavorable",
        value: "Condition météorologique défavorable",
    }
)
Meteo.forEach(obj => {
    AllDetails.push({ ...obj, name: "Condition météorologique défavorable" });
    obj.name = "Condition météorologique défavorable"
})



AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Fatigue",
        value: "Fatigue",
    }
)
Fatigue.forEach(obj => {
    AllDetails.push({ ...obj, name: "Fatigue" });
    obj.name = "Fatigue"
})


AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Gêne / douleur / blessure",
        value: "Gêne / douleur / blessure",
    }
)
DouleurSeance.forEach(obj => {
    AllDetails.push({ ...obj, name: "Gêne / douleur / blessure" });
    obj.name = "Gêne / douleur / blessure"
})


AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Alcool, drogue, sexe...",
        value: "Alcool, drogue, sexe...",
    }
)
DRUG.forEach(obj => {
    AllDetails.push({ ...obj, name: "Alcool, drogue, sexe..." });
    obj.name = "Alcool, drogue, sexe..."
})


AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Alcool, drogue, sexe...",
        value: "Alcool, drogue, sexe...",
    }
)
DRUG.forEach(obj => {
    AllDetails.push({ ...obj, name: "Alcool, drogue, sexe..." });
    obj.name = "Alcool, drogue, sexe..."
})



AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Environnement",
        value: "Environnement",
    }
)
Environnement.forEach(obj => {
    AllDetails.push({ ...obj, name: "Environnement" });
    obj.name = "Environnement"
})


AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Pre Workout, Café...",
        value: "Pre Workout, Café...",
    }
)
Preworkout.forEach(obj => {
    AllDetails.push({ ...obj, name: "Pre Workout, Café..." });
    obj.name = "Pre Workout, Café..."
})


AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Etat psychologique",
        value: "Etat psychologique",
    }
)
Psycho.forEach(obj => {
    AllDetails.push({ ...obj, name: "Etat psychologique" });
    obj.name = "Etat psychologique"
})



AllDetails.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Séance seul ou à plusieurs",
        value: "Séance seul ou à plusieurs",
    }
)
Seul.forEach(obj => {
    AllDetails.push({ ...obj, name: "Séance seul ou à plusieurs" });
    obj.name = "Séance seul ou à plusieurs"
})


//get rid of / défaut
AllDetails.forEach((obj, indexObj) => {
    if (obj.label === "/ (défaut)") {
        delete AllDetails[indexObj]
    }
    if (obj.label === "Aucun (défaut)") {
        delete AllDetails[indexObj]
    }
})

//keep unique
let AllDetailsUniqueLabels = [];
AllDetails.forEach(obj => {
    let stringRes = JSON.stringify(AllDetailsUniqueLabels)
    if (!stringRes.includes(obj.label) || obj.label === "") {
        AllDetailsUniqueLabels.push(obj)
    }
})

module.exports = AllDetailsUniqueLabels;