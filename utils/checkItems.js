const checkPerformance = require("../utils/performance.js").checkPerformance

function getCheckItems(seances) {

    let checkItems = {};

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

    return checkItems;
}

module.exports = { getCheckItems }