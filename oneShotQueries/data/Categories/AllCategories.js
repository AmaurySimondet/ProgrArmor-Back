// Import all detail arrays
const AccessoireObjets = require('./AccessoireObjet');
const lesTypesBarres = require('./TypesBarres');
const Streetworkout = require('./StreetWorkout');
const MusclesCategorie = require('./MusclesCategorie');
const PositionCorps = require('./PositionCorps');
const PositionBras = require('./PositionBras');
const PositionJambes = require('./PositionJambes');
const positionElastique = require('./PositionElastique');
const PositionMains = require('./PositionMains');
const PositionPieds = require('./PositionPieds');
const AxeCategorie = require('./AxeCategorie');
const CoudeGenou = require('./CoudeGenou');
const Unilateral = require('./Unilateral');
const Execution = require('./ExecutionCategorie');
const ExecutionSpecifique = require('./ExecutionSpecifique');
const PriseCategorie = require('./PriseCategorie');
const TempoCategorie = require('./TempoCategorie');
const Partiel = require('./Partiel');
const DépartCategorie = require('./DépartCategorie');
const ExplosifCategorie = require('./ExplosifCategorie');
const Halterophilie = require('./Halterophilie');
const RPE = require('./RPE');
const Douleur = require('./Douleur');

let AllCategories = []


AllCategories.push({
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
        label: "Aucune",
        value: "title",
    },
    {
        id: "name",
        className: "select-item",
        label: "Aucune",
        value: "Aucune",
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
        label: "Muscle",
        value: "title",
    })
MusclesCategorie.forEach(obj => {
    AllCategories.push({ ...obj, name: "Muscle" });
    obj.name = "Muscle"
})




AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Positionnement du corps",
        value: "Positionnement du corps",
    }
)
PositionCorps.forEach(obj => {
    AllCategories.push({ ...obj, name: "Positionnement du corps" });
    obj.name = "Positionnement du corps"
})
AllCategories.push(
    {
        id: "name",
        className: "select-title",
        label: "",
        value: "title",
    }, {
    id: "name",
    className: "select-title",
    label: "Positionnement des bras",
    value: "Positionnement des bras",
})
PositionBras.forEach(obj => {
    AllCategories.push({ ...obj, name: "Positionnement des bras" });
    obj.name = "Positionnement des bras"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Positionnement des jambes",
    value: "Positionnement des jambes",
})
PositionJambes.forEach(obj => {
    AllCategories.push({ ...obj, name: "Positionnement des jambes" });
    obj.name = "Positionnement des jambes"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Positionnement des mains",
    value: "Positionnement des mains",
})
PositionMains.forEach(obj => {
    AllCategories.push({ ...obj, name: "Positionnement des mains" });
    obj.name = "Positionnement des mains"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Positionnement des pieds",
    value: "Positionnement des pieds",
})
PositionPieds.forEach(obj => {
    AllCategories.push({ ...obj, name: "Positionnement des pieds" });
    obj.name = "Positionnement des pieds"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Positionnement élastique(s)/sangle(s)",
    value: "Positionnement élastique(s)/sangle(s)",
})
positionElastique.forEach(obj => {
    AllCategories.push({ ...obj, name: "Positionnement élastique(s)/sangle(s)" });
    obj.name = "Positionnement élastique(s)/sangle(s)"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Ouverture coudes / genoux",
    value: "Ouverture coudes / genoux",
})
CoudeGenou.forEach(obj => {
    AllCategories.push({ ...obj, name: "Ouverture coudes / genoux" });
    obj.name = "Ouverture coudes / genoux"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Placement et axe du corps / banc / barre",
    value: "Placement et axe du corps / banc / barre",
})
AxeCategorie.forEach(obj => {
    AllCategories.push({ ...obj, name: "Placement et axe du corps / banc / barre" });
    obj.name = "Placement et axe du corps / banc / barre"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Type de prise",
    value: "Type de prise",
})
PriseCategorie.forEach(obj => {
    AllCategories.push({ ...obj, name: "Type de prise" });
    obj.name = "Type de prise"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Point de départ",
    value: "Point de départ",
})
DépartCategorie.forEach(obj => {
    AllCategories.push({ ...obj, name: "Point de départ" });
    obj.name = "Point de départ"
})




AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "Type de barre / poids / machine",
    value: "Type de barre / poids / machine",
})
lesTypesBarres.forEach(obj => {
    AllCategories.push({ ...obj, name: "Type de barre / poids" });
    obj.name = "Type de barre / poids"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Elastique",
    value: "Elastique",
})
// pas mettre les elastiques
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Accessoire supplémentaire ou objet spécifique",
    value: "Accessoire supplémentaire ou objet spécifique",
})
AccessoireObjets.forEach(obj => {
    AllCategories.push({ ...obj, name: "Accessoire supplémentaire ou objet spécifique" });
    obj.name = "Accessoire supplémentaire ou objet spécifique"
})






AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "Unilatéral",
    value: "Unilatéral",
})
Unilateral.forEach(obj => {
    AllCategories.push({ ...obj, name: "Unilatéral" });
    obj.name = "Unilatéral"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Type d'éxecution",
    value: "Type d'éxecution",
})
Execution.forEach(obj => {
    AllCategories.push({ ...obj, name: "Type d'éxecution" });
    obj.name = "Type d'éxecution"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Type d'éxecution spécifique",
    value: "Type d'éxecution spécifique",
})
ExecutionSpecifique.forEach(obj => {
    AllCategories.push({ ...obj, name: "Type d'éxecution spécifique" });
    obj.name = "Type d'éxecution spécifique"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Tempo",
    value: "Tempo",
})
TempoCategorie.forEach(obj => {
    AllCategories.push({ ...obj, name: "Tempo" });
    obj.name = "Tempo"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Forme (Partiel)",
    value: "Forme (Partiel)",
})
Partiel.forEach(obj => {
    AllCategories.push({ ...obj, name: "Forme (Partiel)" });
    obj.name = "Forme (Partiel)"
})






AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "Variante Street Workout",
    value: "Variante Street Workout",
})
Streetworkout.forEach(obj => {
    AllCategories.push({ ...obj, name: "Variante Street Workout" });
    obj.name = "Variante Street Workout"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Variante d'exercice explosif",
    value: "Variante d'exercice explosif",
})
ExplosifCategorie.forEach(obj => {
    AllCategories.push({ ...obj, name: "Variante d'exercice explosif" });
    obj.name = "Variante d'exercice explosif"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Variante d'exercice d'haltérophilie",
    value: "Variante d'exercice d'haltérophilie",
})
Halterophilie.forEach(obj => {
    AllCategories.push({ ...obj, name: "Variante d'exercice d'haltérophilie" });
    obj.name = "Variante d'exercice d'haltérophilie"
})




AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Temps de repos entre les séries",
        value: "Temps de repos entre les séries",
    },
    {
        id: "name",
        className: "select-title",
        label: "",
        value: "title",
    })
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "RPE / Niveau d'intensité",
    value: "RPE / Niveau d'intensité",
})
RPE.forEach(obj => {
    AllCategories.push({ ...obj, name: "RPE / Niveau d'intensité" });
    obj.name = "RPE / Niveau d'intensité"
})
AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
}, {
    id: "name",
    className: "select-title",
    label: "Gêne / douleur / blessure",
    value: "Gêne / douleur / blessure",
})
Douleur.forEach(obj => {
    AllCategories.push({ ...obj, name: "Gêne / douleur / blessure" });
    obj.name = "Gêne / douleur / blessure"
})

AllCategories.push({
    id: "name",
    className: "select-title",
    label: "",
    value: "title",
},
    {
        id: "name",
        className: "select-title",
        label: "Terme générique",
        value: "title",
    }, {
    id: "input",
    name: "Terme générique",
    className: "select-item",
    label: "Elevation",
    value: "Elevation",
},
    {
        id: "input",
        name: "Terme générique",
        className: "select-item",
        label: "Curl / Flexion",
        value: "Curl / Flexion",
    },
    {
        id: "input",
        name: "Terme générique",
        className: "select-item",
        label: "Extension",
        value: "Extension",
    },
    {
        id: "input",
        name: "Terme générique",
        className: "select-item",
        label: "Abduction",
        value: "Abduction",
    },
    {
        id: "input",
        name: "Terme générique",
        className: "select-item",
        label: "Adduction",
        value: "Adduction",
    },
    {
        id: "input",
        name: "Terme générique",
        className: "select-item",
        label: "Press",
        value: "Press",
    })


//get rid of / défaut
AllCategories.forEach((obj, indexObj) => {
    if (obj.label === "/ (défaut)") {
        delete AllCategories[indexObj]
    }
    if (obj.label === "Aucun (défaut)") {
        delete AllCategories[indexObj]
    }
})

//keep unique
let AllCategoriesUniqueLabels = [];
AllCategories.forEach(obj => {
    let stringRes = JSON.stringify(AllCategoriesUniqueLabels)
    if (!stringRes.includes(obj.label) || obj.label === "" || obj.label === "Elastique") {
        AllCategoriesUniqueLabels.push(obj)
    }
})

module.exports = AllCategoriesUniqueLabels;