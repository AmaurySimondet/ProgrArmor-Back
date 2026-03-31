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

// Mapping manuel des 95 variations restantes vers leurs muscles
const MANUAL = {
    "669ced7e665a3ffe7771438f": { primary: [MUSCLES.OBLIQUES], secondary: [MUSCLES.ABS, MUSCLES.DELT_SIDE] }, // Escanor Hold
    "669ced7e665a3ffe7771437c": { primary: [MUSCLES.LATS], secondary: [MUSCLES.CHEST, MUSCLES.DELT_FRONT, MUSCLES.BICEPS, MUSCLES.ABS] }, // Muscle-up
    "669ced7e665a3ffe7771436e": { primary: [MUSCLES.DELT_REAR], secondary: [MUSCLES.TRAPS, MUSCLES.BICEPS] }, // Face Pull
    "669ced7e665a3ffe77714398": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES, MUSCLES.SPINAL_ERECTORS] }, // Ab Wheel Rollout
    "669c3609218324e0b7682b49": { primary: [MUSCLES.SPINAL_ERECTORS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS] }, // Superman
    "669ced7e665a3ffe777143a4": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES] }, // Scissor Kicks
    "669ced7e665a3ffe77714391": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Skin the Cat
    "669ced7e665a3ffe777143bc": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Clean
    "669ced7e665a3ffe777143a5": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES] }, // Windshield Wipers
    "669ced7e665a3ffe77714392": { primary: [MUSCLES.FOREARMS], secondary: [MUSCLES.BICEPS, MUSCLES.DELT_FRONT] }, // Bar Spin (360)
    "669ced7e665a3ffe77714370": { primary: [MUSCLES.TRICEPS], secondary: [MUSCLES.DELT_FRONT] }, // Lying Tricep Extension
    "669ced7e665a3ffe7771437e": { primary: [MUSCLES.ABS], secondary: [MUSCLES.SPINAL_ERECTORS, MUSCLES.HAMSTRINGS] }, // Dragon Flag
    "669ced7e665a3ffe7771439d": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES, MUSCLES.HIP_FLEXORS || MUSCLES.QUADS] }, // Hanging Knee Raise
    "669ced7e665a3ffe7771439b": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES] }, // Sit Ups
    "669ced7e665a3ffe777143a2": { primary: [MUSCLES.GLUTES], secondary: [MUSCLES.HAMSTRINGS, MUSCLES.SPINAL_ERECTORS] }, // Reverse Hyperextension
    "669ced7e665a3ffe777143bb": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Snatch
    "692081fef94b17a153ce44c5": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES, MUSCLES.QUADS] }, // V-Up
    "6922144b1c858345acc2d069": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Power Clean
    "6922144c1c858345acc2d08c": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT, MUSCLES.TRICEPS] }, // Clean and Jerk
    "6922144c1c858345acc2d0ac": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE, MUSCLES.FOREARMS] }, // Barbell Shrug
    "6922144c1c858345acc2d0c5": { primary: [MUSCLES.ADDUCTORS], secondary: [MUSCLES.GLUTES] }, // Hip Adduction
    "6922144c1c858345acc2d0c8": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE, MUSCLES.FOREARMS] }, // Dumbbell Shrug
    "6922144d1c858345acc2d0ea": { primary: [MUSCLES.HAMSTRINGS], secondary: [MUSCLES.GLUTES, MUSCLES.SPINAL_ERECTORS] }, // Rack Pull
    "6922144d1c858345acc2d111": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.CALVES, MUSCLES.DELT_SIDE] }, // Jumping Jack
    "6922144d1c858345acc2d126": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Hang Clean
    "6922144d1c858345acc2d135": { primary: [MUSCLES.SPINAL_ERECTORS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS] }, // Back Extension
    "6922144d1c858345acc2d148": { primary: [MUSCLES.ABDUCTORS], secondary: [MUSCLES.GLUTES] }, // Hip Abduction
    "6922144e1c858345acc2d15e": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.DELT_FRONT, MUSCLES.TRICEPS] }, // Thruster
    "6922144e1c858345acc2d173": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES, MUSCLES.HIP_FLEXORS || MUSCLES.QUADS] }, // Decline Sit Up
    "6922144e1c858345acc2d182": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Power Snatch
    "6922144e1c858345acc2d19a": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.DELT_FRONT, MUSCLES.TRICEPS] }, // Push Jerk
    "6922144f1c858345acc2d1d0": { primary: [MUSCLES.GLUTES], secondary: [MUSCLES.HAMSTRINGS, MUSCLES.SPINAL_ERECTORS] }, // Cable Pull Through
    "6922144f1c858345acc2d1ec": { primary: [MUSCLES.SPINAL_ERECTORS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS] }, // Machine Back Extension
    "6922144f1c858345acc2d1f5": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Hang Power Clean
    "692214501c858345acc2d226": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE, MUSCLES.FOREARMS] }, // Hex Bar Shrug
    "692214501c858345acc2d22c": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE] }, // Smith Machine Shrug
    "692214501c858345acc2d238": { primary: [MUSCLES.OBLIQUES], secondary: [MUSCLES.ABS] }, // Dumbbell Side Bend
    "692214501c858345acc2d23b": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.DELT_FRONT, MUSCLES.TRICEPS] }, // Split Jerk
    "692214501c858345acc2d244": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE, MUSCLES.FOREARMS] }, // Barbell Power Shrug
    "692214501c858345acc2d24a": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE, MUSCLES.FOREARMS] }, // Behind The Back Barbell Shrug
    "692214501c858345acc2d251": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Clean High Pull
    "692214501c858345acc2d255": { primary: [MUSCLES.GLUTES], secondary: [MUSCLES.HAMSTRINGS] }, // Glute Kickback
    "692214501c858345acc2d25b": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Clean Pull
    "692214501c858345acc2d267": { primary: [MUSCLES.GLUTES], secondary: [MUSCLES.HAMSTRINGS, MUSCLES.SPINAL_ERECTORS] }, // Hip Extension
    "692214501c858345acc2d282": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Muscle Snatch
    "692214501c858345acc2d285": { primary: [MUSCLES.HAMSTRINGS], secondary: [MUSCLES.GLUTES, MUSCLES.SPINAL_ERECTORS] }, // Glute Ham Raise
    "692214511c858345acc2d29e": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Snatch Pull
    "692214511c858345acc2d2aa": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE] }, // Machine Shrug
    "692214511c858345acc2d2ae": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.DELT_FRONT] }, // Dumbbell Snatch
    "692214511c858345acc2d2b7": { primary: [MUSCLES.GLUTES], secondary: [MUSCLES.HAMSTRINGS] }, // Cable Kickback
    "692214511c858345acc2d2ba": { primary: [MUSCLES.NECK || MUSCLES.TRAPS], secondary: [] }, // Neck Extension
    "692214511c858345acc2d2c6": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE] }, // Cable Shrug
    "692214511c858345acc2d2cc": { primary: [MUSCLES.OBLIQUES], secondary: [MUSCLES.ABS] }, // Cable Woodchopper
    "692214511c858345acc2d2d2": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.TRAPS, MUSCLES.DELT_FRONT] }, // Hang Snatch
    "692214511c858345acc2d2e7": { primary: [MUSCLES.OBLIQUES], secondary: [MUSCLES.ABS] }, // Roman Chair Side Bend
    "692214511c858345acc2d30b": { primary: [MUSCLES.GLUTES], secondary: [MUSCLES.HAMSTRINGS] }, // Floor Hip Extension
    "692214521c858345acc2d314": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.DELT_FRONT, MUSCLES.TRICEPS] }, // Wall Ball
    "692214521c858345acc2d317": { primary: [MUSCLES.ABDUCTORS], secondary: [MUSCLES.GLUTES] }, // Floor Hip Abduction
    "692214521c858345acc2d323": { primary: [MUSCLES.LATS], secondary: [MUSCLES.CHEST, MUSCLES.DELT_FRONT, MUSCLES.BICEPS, MUSCLES.ABS] }, // Ring Muscle Ups
    "692214521c858345acc2d326": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.DELT_FRONT, MUSCLES.TRICEPS] }, // Dumbbell Thruster
    "692214521c858345acc2d32c": { primary: [MUSCLES.TRAPS], secondary: [MUSCLES.DELT_SIDE, MUSCLES.FOREARMS] }, // Dumbbell High Pull
    "692214521c858345acc2d32f": { primary: [MUSCLES.DELT_REAR], secondary: [MUSCLES.TRAPS, MUSCLES.BICEPS] }, // Dumbbell Face Pull
    "692214521c858345acc2d332": { primary: [MUSCLES.QUADS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS, MUSCLES.DELT_FRONT] }, // Dumbbell Hang Clean
    "692214521c858345acc2d33b": { primary: [MUSCLES.DELT_SIDE], secondary: [MUSCLES.DELT_REAR, MUSCLES.TRAPS] }, // Dumbbell Incline Y Raise
    "692214521c858345acc2d341": { primary: [MUSCLES.ROTATOR_CUFF || MUSCLES.DELT_REAR], secondary: [] }, // Cable External Rotation
    "692214521c858345acc2d344": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES, MUSCLES.HIP_FLEXORS || MUSCLES.QUADS] }, // Flutter Kicks
    "692214521c858345acc2d37f": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Ring Support Hold
    "692214531c858345acc2d391": { primary: [MUSCLES.FOREARMS], secondary: [MUSCLES.LATS, MUSCLES.DELT_SIDE] }, // Passive Hang
    "692214531c858345acc2d3b8": { primary: [MUSCLES.LATS], secondary: [MUSCLES.CHEST, MUSCLES.DELT_FRONT, MUSCLES.BICEPS, MUSCLES.ABS] }, // Muscle-Up (Kipping)
    "692214531c858345acc2d3bb": { primary: [MUSCLES.LATS], secondary: [MUSCLES.CHEST, MUSCLES.DELT_FRONT, MUSCLES.BICEPS, MUSCLES.ABS] }, // Wide Grip Muscle-Up
    "692214531c858345acc2d3c1": { primary: [MUSCLES.DELT_REAR], secondary: [MUSCLES.TRAPS, MUSCLES.BICEPS] }, // Ring Face Pull
    "692214531c858345acc2d3c7": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Hefesto
    "692214531c858345acc2d3df": { primary: [MUSCLES.CALVES], secondary: [] }, // Tibialis Raise (cheville / tibial antérieur; on l'approche via calves)
    "692214531c858345acc2d3eb": { primary: [MUSCLES.SPINAL_ERECTORS], secondary: [MUSCLES.GLUTES, MUSCLES.HAMSTRINGS] }, // Superman / Arch Hold
    "692214531c858345acc2d3f0": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES, MUSCLES.SPINAL_ERECTORS] }, // Ab Wheel Rollout (Kneeling)
    "692214531c858345acc2d3f3": { primary: [MUSCLES.ABS], secondary: [MUSCLES.OBLIQUES, MUSCLES.SPINAL_ERECTORS] }, // Ab Wheel Rollout (Standing)
    "692214531c858345acc2d3f7": { primary: [MUSCLES.DELT_SIDE], secondary: [MUSCLES.DELT_FRONT, MUSCLES.DELT_REAR, MUSCLES.TRAPS] }, // Around the World
    "692214541c858345acc2d3ff": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Headstand
    "692214541c858345acc2d402": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Handstand Wall Hold
    "692214541c858345acc2d405": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Free Handstand
    "692214541c858345acc2d408": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // One Arm Handstand
    "692214541c858345acc2d40b": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Planche Lean
    "692214541c858345acc2d40e": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Tuck Planche
    "692214541c858345acc2d411": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Advanced Tuck Planche
    "692214541c858345acc2d414": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Straddle Planche
    "692214541c858345acc2d417": { primary: [MUSCLES.DELT_FRONT], secondary: [MUSCLES.TRICEPS, MUSCLES.ABS] }, // Full Planche
    "692214541c858345acc2d41a": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Tuck Front Lever
    "692214541c858345acc2d41d": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Advanced Tuck Front Lever
    "692214541c858345acc2d420": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // One Leg Front Lever
    "692214541c858345acc2d423": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Straddle Front Lever
    "692214541c858345acc2d426": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Full Front Lever
    "692214541c858345acc2d429": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // German Hang
    "692214541c858345acc2d42c": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Tuck Back Lever
    "692214541c858345acc2d42f": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] }, // Full Back Lever
    "692214541c858345acc2d444": { primary: [MUSCLES.LATS], secondary: [MUSCLES.BICEPS, MUSCLES.ABS] } // Back Hip Circle
};

function main() {
    const raw = fs.readFileSync(VARIATIONS_PATH, "utf8");
    const data = JSON.parse(raw);

    let fixed = 0;

    const updated = data.map((variation) => {
        if (!variation.isExercice || !variation._id || !variation._id.$oid) {
            return variation;
        }
        const id = variation._id.$oid;
        if (!MANUAL[id]) {
            return variation;
        }

        const v = { ...variation };
        v.muscles = {
            primary: MANUAL[id].primary,
            secondary: MANUAL[id].secondary
        };
        fixed++;
        return v;
    });

    fs.writeFileSync(VARIATIONS_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");

    console.log(`Variations corrigées manuellement : ${fixed}`);
}

main();

