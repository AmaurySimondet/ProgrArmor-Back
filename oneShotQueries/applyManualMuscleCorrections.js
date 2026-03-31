const fs = require("fs");
const path = require("path");

const VARIATIONS_PATH = path.join(__dirname, "..", "data", "progarmor.variations.json");

const CORRECTIONS = {
  "669ced7e665a3ffe7771438f": {
    primary: ["deltoids_front"],
    secondary: ["triceps", "forearms", "chest"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe7771437c": {
    primary: ["lats"],
    secondary: ["chest", "deltoids_front", "biceps", "triceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214521c858345acc2d323": {
    primary: ["lats"],
    secondary: ["chest", "deltoids_front", "biceps", "triceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214531c858345acc2d3b8": {
    primary: ["lats"],
    secondary: ["chest", "deltoids_front", "biceps", "triceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214531c858345acc2d3bb": {
    primary: ["lats"],
    secondary: ["chest", "deltoids_front", "biceps", "triceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214521c858345acc2d37f": {
    primary: ["triceps"],
    secondary: ["chest", "deltoids_front", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214531c858345acc2d3c7": {
    primary: ["biceps"],
    secondary: ["lats", "deltoids_front", "forearms"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe77714398": {
    primary: ["abs"],
    secondary: ["obliques", "spinal_erectors", "lats"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214531c858345acc2d3f0": {
    primary: ["abs"],
    secondary: ["obliques", "spinal_erectors", "lats"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214531c858345acc2d3f3": {
    primary: ["abs"],
    secondary: ["obliques", "spinal_erectors", "lats"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "6922144d1c858345acc2d135": {
    primary: ["spinal_erectors"],
    secondary: ["glutes", "hamstrings"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214501c858345acc2d267": {
    primary: ["glutes"],
    secondary: ["hamstrings", "spinal_erectors"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe77714377": {
    primary: ["glutes"],
    secondary: ["quads", "hamstrings"],
    weightType: "external_free",
    includeBodyweight: false
  },
  "669ced7e665a3ffe77714397": {
    primary: ["abs"],
    secondary: ["obliques", "quads"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe7771439f": {
    primary: ["abs"],
    secondary: ["obliques", "quads", "forearms"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe7771436e": {
    primary: ["deltoids_rear"],
    secondary: ["traps", "biceps"],
    weightType: "external_machine",
    includeBodyweight: false
  },
  "692214541c858345acc2d41a": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d41d": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d420": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d423": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d426": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d429": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d42c": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d42f": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "6922144b1c858345acc2d042": {
    primary: ["quads"],
    secondary: ["glutes", "hamstrings", "calves"],
    weightType: "external_machine",
    includeBodyweight: false
  },
  "6921e77ef94b17a153ce44c6": {
    primary: ["lats"],
    secondary: ["chest", "triceps"],
    weightType: "external_free",
    includeBodyweight: false
  },
  "669ced7e665a3ffe77714391": {
    primary: ["lats"],
    secondary: ["biceps", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe7771437e": {
    primary: ["abs"],
    secondary: ["obliques", "lats", "glutes"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe7771439e": {
    primary: ["abs"],
    secondary: ["obliques", "quads", "forearms"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe777143a3": {
    primary: ["abs"],
    secondary: ["quads", "obliques", "triceps"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214531c858345acc2d3d9": {
    primary: ["abs"],
    secondary: ["quads", "obliques", "triceps"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214531c858345acc2d3e5": {
    primary: ["deltoids_front"],
    secondary: ["triceps", "traps"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d432": {
    primary: ["obliques"],
    secondary: ["lats", "deltoids_side", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "692214541c858345acc2d435": {
    primary: ["obliques"],
    secondary: ["lats", "deltoids_side", "abs"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe77714368": {
    primary: ["triceps"],
    secondary: ["chest", "deltoids_front"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  },
  "669ced7e665a3ffe7771436a": {
    primary: ["lats"],
    secondary: ["biceps", "forearms", "traps"],
    weightType: "bodyweight_plus_external",
    includeBodyweight: true
  }
};

function main() {
  const raw = fs.readFileSync(VARIATIONS_PATH, "utf8");
  const data = JSON.parse(raw);

  let applied = 0;

  const updated = data.map((variation) => {
    if (!variation.isExercice || !variation._id || !variation._id.$oid) {
      return variation;
    }
    const id = variation._id.$oid;
    const corr = CORRECTIONS[id];
    if (!corr) {
      return variation;
    }
    const v = { ...variation };
    v.muscles = {
      primary: corr.primary,
      secondary: corr.secondary
    };
    v.weightType = corr.weightType;
    v.includeBodyweight = corr.includeBodyweight;
    applied++;
    return v;
  });

  fs.writeFileSync(VARIATIONS_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");
  console.log(`Corrections appliquées: ${applied}`);
}

main();

