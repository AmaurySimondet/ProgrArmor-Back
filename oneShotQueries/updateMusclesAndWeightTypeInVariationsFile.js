const fs = require("fs");
const path = require("path");

const VARIATIONS_PATH = path.join(__dirname, "..", "data", "progarmor.variations.json");

const MUSCLES = {
    CHEST: "chest",
    UPPER_BACK: "upper_back",
    LATS: "lats",
    TRAPS: "traps",
    NECK: "neck",
    DELT_FRONT: "deltoids_front",
    DELT_SIDE: "deltoids_side",
    DELT_REAR: "deltoids_rear",
    BICEPS: "biceps",
    TRICEPS: "triceps",
    FOREARMS: "forearms",
    ABS: "abs",
    OBLIQUES: "obliques",
    SPINAL_ERECTORS: "spinal_erectors",
    GLUTES: "glutes",
    HAMSTRINGS: "hamstrings",
    QUADS: "quads",
    ADDUCTORS: "adductors",
    ABDUCTORS: "abductors",
    CALVES: "calves"
};

const WEIGHT_TYPES = {
    BODYWEIGHT_PLUS_EXTERNAL: "bodyweight_plus_external",
    EXTERNAL_FREE: "external_free",
    EXTERNAL_MACHINE: "external_machine"
};

function normalize(str) {
    if (!str) return "";
    return str
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function getNames(variation) {
    const fr = variation?.normalizedName?.fr || variation?.name?.fr || "";
    const en = variation?.normalizedName?.en || variation?.name?.en || "";
    const merged = `${fr} ${en}`;
    const n = normalize(merged);
    return { fr: normalize(fr), en: normalize(en), merged: n };
}

function getWeightType(variation) {
    const { merged } = getNames(variation);

    // Machine / poulie / guidé
    if (
        /machine/.test(merged) ||
        /poulie/.test(merged) ||
        /cable/.test(merged) ||
        /pulldown/.test(merged) ||
        /pull-down/.test(merged) ||
        /leg extension/.test(merged) ||
        /leg curl/.test(merged)
    ) {
        return WEIGHT_TYPES.EXTERNAL_MACHINE;
    }

    // Exercices typiquement poids du corps (potentiellement lestables)
    if (
        /pompe/.test(merged) ||
        /pushup/.test(merged) ||
        /push-up/.test(merged) ||
        /pullup/.test(merged) ||
        /pull-up/.test(merged) ||
        /chinup/.test(merged) ||
        /chin-up/.test(merged) ||
        /traction/.test(merged) ||
        /muscle up/.test(merged) ||
        /muscleup/.test(merged) ||
        /dip/.test(merged) ||
        /hspu/.test(merged) ||
        /handstand push/.test(merged) ||
        /planche/.test(merged) ||
        /lsit/.test(merged) ||
        /l-sit/.test(merged) ||
        /vsit/.test(merged) ||
        /v-sit/.test(merged) ||
        /human flag/.test(merged) ||
        /burpee/.test(merged) ||
        /bear crawl/.test(merged)
    ) {
        return WEIGHT_TYPES.BODYWEIGHT_PLUS_EXTERNAL;
    }

    // Par défaut : charges libres (barre, haltères, kettlebell, etc.)
    return WEIGHT_TYPES.EXTERNAL_FREE;
}

function getMuscles(variation) {
    const { merged } = getNames(variation);
    const primary = [];
    const secondary = [];

    const addPrimary = (m) => {
        if (!primary.includes(m)) primary.push(m);
    };
    const addSecondary = (m) => {
        if (!secondary.includes(m) && !primary.includes(m)) secondary.push(m);
    };

    // Haut du corps : poussée (pecs/épaules/triceps)
    if (
        /bench/.test(merged) ||
        /developpe/.test(merged) ||
        /press/.test(merged) ||
        /pompe/.test(merged) ||
        /pushup/.test(merged) ||
        /push-up/.test(merged) ||
        /dip/.test(merged) ||
        /fly/.test(merged) ||
        /pec/.test(merged)
    ) {
        addPrimary(MUSCLES.CHEST);
        addSecondary(MUSCLES.DELT_FRONT);
        addSecondary(MUSCLES.TRICEPS);
    }

    // Haut du corps : tirage vertical/horizontal
    if (
        /row/.test(merged) ||
        /rowing/.test(merged) ||
        /pullup/.test(merged) ||
        /pull-up/.test(merged) ||
        /chinup/.test(merged) ||
        /chin-up/.test(merged) ||
        /traction/.test(merged) ||
        /pulldown/.test(merged) ||
        /pull-down/.test(merged) ||
        /pullover/.test(merged)
    ) {
        addPrimary(MUSCLES.LATS);
        addSecondary(MUSCLES.UPPER_BACK);
        addSecondary(MUSCLES.BICEPS);
        addSecondary(MUSCLES.FOREARMS);
    }

    // Épaules
    if (
        /elevations laterales/.test(merged) ||
        /lateral raise/.test(merged) ||
        /front raise/.test(merged) ||
        /rear delt/.test(merged) ||
        /shoulder press/.test(merged) ||
        /developpe militaire/.test(merged) ||
        /overhead press/.test(merged)
    ) {
        addPrimary(MUSCLES.DELT_SIDE);
        addSecondary(MUSCLES.DELT_FRONT);
        addSecondary(MUSCLES.DELT_REAR);
        addSecondary(MUSCLES.TRICEPS);
    }

    // Bras
    if (/curl/.test(merged) || /biceps/.test(merged)) {
        addPrimary(MUSCLES.BICEPS);
        addSecondary(MUSCLES.FOREARMS);
    }
    if (/triceps/.test(merged) || /extension nuque/.test(merged)) {
        addPrimary(MUSCLES.TRICEPS);
        addSecondary(MUSCLES.DELT_FRONT);
    }

    // Bas du corps : squat / fente / presse / hip thrust
    if (
        /squat/.test(merged) ||
        /front squat/.test(merged) ||
        /split squat/.test(merged) ||
        /bulgarian/.test(merged) ||
        /presse a cuisses/.test(merged) ||
        /leg press/.test(merged) ||
        /hip thrust/.test(merged) ||
        /glute bridge/.test(merged) ||
        /step up/.test(merged) ||
        /lunge/.test(merged)
    ) {
        addPrimary(MUSCLES.QUADS);
        addSecondary(MUSCLES.GLUTES);
        addSecondary(MUSCLES.HAMSTRINGS);
        addSecondary(MUSCLES.CALVES);
    }

    // Deadlift / posterior chain
    if (
        /deadlift/.test(merged) ||
        /souleve de terre/.test(merged) ||
        /romanian/.test(merged) ||
        /good morning/.test(merged)
    ) {
        addPrimary(MUSCLES.HAMSTRINGS);
        addSecondary(MUSCLES.GLUTES);
        addSecondary(MUSCLES.SPINAL_ERECTORS);
        addSecondary(MUSCLES.QUADS);
    }

    // Isos jambes
    if (/leg curl/.test(merged) || /curl ischio/.test(merged)) {
        addPrimary(MUSCLES.HAMSTRINGS);
        addSecondary(MUSCLES.GLUTES);
    }
    if (/leg extension/.test(merged) || /extension de jambe/.test(merged)) {
        addPrimary(MUSCLES.QUADS);
    }
    if (/calf/.test(merged) || /mollet/.test(merged) || /calf raise/.test(merged)) {
        addPrimary(MUSCLES.CALVES);
    }
    if (/adducteur/.test(merged) || /adductor/.test(merged)) {
        addPrimary(MUSCLES.ADDUCTORS);
    }
    if (/abducteur/.test(merged) || /abductor/.test(merged) || /band walk/.test(merged)) {
        addPrimary(MUSCLES.ABDUCTORS);
    }

    // Core / gainage
    if (
        /crunch/.test(merged) ||
        /situp/.test(merged) ||
        /sit-up/.test(merged) ||
        /plank/.test(merged) ||
        /planche gainage/.test(merged) ||
        /hollow/.test(merged) ||
        /v-sit/.test(merged) ||
        /vsit/.test(merged) ||
        /l-sit/.test(merged) ||
        /lsit/.test(merged) ||
        /toes to bar/.test(merged) ||
        /releve de jambes/.test(merged) ||
        /leg raise/.test(merged)
    ) {
        addPrimary(MUSCLES.ABS);
        addSecondary(MUSCLES.OBLIQUES);
        addSecondary(MUSCLES.HIP_FLEXORS || MUSCLES.QUADS);
    }

    // Mountain climbers / grimpeur : core + quads/épaules
    if (/mountain climber/.test(merged) || /grimpeur/.test(merged)) {
        addPrimary(MUSCLES.ABS);
        addSecondary(MUSCLES.OBLIQUES);
        addSecondary(MUSCLES.QUADS);
        addSecondary(MUSCLES.DELT_FRONT);
    }

    // Obliques spécifiques
    if (/oblique/.test(merged) || /russian twist/.test(merged)) {
        addPrimary(MUSCLES.OBLIQUES);
        addSecondary(MUSCLES.ABS);
    }

    // Burpees / Navy Seal / Bear crawl / mouvements très full-body
    if (/burpee/.test(merged) || /bear crawl/.test(merged) || /navy seal/.test(merged)) {
        addPrimary(MUSCLES.QUADS);
        addSecondary(MUSCLES.CHEST);
        addSecondary(MUSCLES.DELT_FRONT);
        addSecondary(MUSCLES.GLUTES);
        addSecondary(MUSCLES.ABS);
    }

    // Human flag, planche et grosses figures de tirage/gainage
    if (/human flag/.test(merged) || /drapeau/.test(merged)) {
        addPrimary(MUSCLES.OBLIQUES);
        addSecondary(MUSCLES.LATS);
        addSecondary(MUSCLES.DELT_SIDE);
        addSecondary(MUSCLES.GLUTES);
    }

    // Si on n'a vraiment rien détecté, on essaye un fallback simple :
    if (primary.length === 0) {
        // Try some broad fallbacks by megatype if needed later.
        // Pour l’instant, on laisse vide pour pouvoir les repérer manuellement si besoin.
    }

    return {
        primary,
        secondary
    };
}

function main() {
    const raw = fs.readFileSync(VARIATIONS_PATH, "utf8");
    const data = JSON.parse(raw);

    let updatedCount = 0;
    let missingMuscles = 0;

    const updated = data.map((variation) => {
        if (!variation.isExercice) {
            return variation;
        }

        const v = { ...variation };

        // weightType / includeBodyweight
        if (!v.weightType) {
            v.weightType = getWeightType(v);
            updatedCount++;
        }
        v.includeBodyweight =
            v.weightType === WEIGHT_TYPES.BODYWEIGHT_PLUS_EXTERNAL;

        // muscles
        const autoMuscles = getMuscles(v);
        if (!v.muscles || !Array.isArray(v.muscles.primary) || v.muscles.primary.length === 0) {
            v.muscles = {
                primary: autoMuscles.primary,
                secondary: autoMuscles.secondary
            };
            if (autoMuscles.primary.length === 0) {
                missingMuscles++;
            }
        } else {
            // Si des muscles existent déjà, on n’écrase pas.
        }

        return v;
    });

    fs.writeFileSync(VARIATIONS_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");

    console.log(`Variations mises à jour : ${updatedCount}`);
    console.log(`Exercices sans primary muscle détecté : ${missingMuscles}`);
}

main();

