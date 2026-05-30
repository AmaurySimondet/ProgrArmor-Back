/**
 * Propose/insère des edges de progression pour nouvelles hiérarchies exos.
 *
 * Usage:
 *   node oneShotQueries/proposeExerciseSpecificProgressionEdges.js
 *   node oneShotQueries/proposeExerciseSpecificProgressionEdges.js --apply
 */
const mongoose = require("mongoose");
require("dotenv").config();

const Variation = require("../schema/variation");
const VariationProgressionEdge = require("../schema/variationProgressionEdge");

function getMongoUri() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error("Missing MONGO_URL/mongoURL or DATABASE in environment variables.");
    }
    return mongoUrl + database;
}

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function toObjectId(value) {
    return new mongoose.Types.ObjectId(value);
}

function describeVariation(doc) {
    return {
        _id: String(doc._id),
        isExercice: doc?.isExercice === true,
        verified: doc?.verified === true,
        nameFr: doc?.name?.fr || null,
        nameEn: doc?.name?.en || null
    };
}

const CONCEPTS = [
    { key: "lsit_ex", kind: "exercise", labels: ["l-sit", "lsit"] },
    { key: "vsit_ex", kind: "exercise", labels: ["v-sit", "vsit"] },
    { key: "manna_ex", kind: "exercise", labels: ["manna"] },

    { key: "pushup_knees_ex", kind: "exercise", labels: ["pompes sur les genoux", "knee push-up", "kneeling push-up"] },
    { key: "pushup_ex", kind: "exercise", labels: ["pompe", "pompes", "push-up", "push up"] },
    { key: "archer_pushup_ex", kind: "exercise", labels: ["pompe archer", "archer push-up", "archer push up"] },
    { key: "one_arm_assisted_pushup_ex", kind: "exercise", labels: ["pompe une main assistée", "assisted one arm push-up", "assisted one-arm push-up"] },
    { key: "one_arm_pushup_ex", kind: "exercise", labels: ["pompe une main", "one arm push-up", "one-arm push-up"] },

    { key: "pullup_ex", kind: "exercise", labels: ["traction", "tractions", "pull-up", "pull up", "chin-up", "chin up"] },
    { key: "archer_pullup_ex", kind: "exercise", labels: ["traction archer", "archer pull-up", "archer chin-up"] },
    { key: "one_arm_assisted_pullup_ex", kind: "exercise", labels: ["traction un bras assistée", "assisted one arm pull-up", "assisted one-arm pull-up"] },
    { key: "one_arm_pullup_ex", kind: "exercise", labels: ["traction un bras", "one arm pull-up", "one-arm pull-up"] },

    { key: "dip_ex", kind: "exercise", labels: ["dip", "dips"] },
    { key: "archer_dip_ex", kind: "exercise", labels: ["dip archer", "archer dip", "dips archer"] },
    { key: "one_arm_assisted_dip_ex", kind: "exercise", labels: ["dip un bras assisté", "assisted one arm dip", "assisted one-arm dip"] },
    { key: "one_arm_dip_ex", kind: "exercise", labels: ["dip un bras", "one arm dip", "one-arm dip"] },

    { key: "human_flag_ex", kind: "exercise", labels: ["drapeau", "human flag"] },

    { key: "vertical_detail", kind: "detail", labels: ["vertical"] },
    { key: "tuck_detail", kind: "detail", labels: ["tuck"] },
    { key: "archer_detail", kind: "detail", labels: ["archer"] },
    { key: "assisted_detail", kind: "detail", labels: ["assisté", "assisted"] },
    { key: "one_hand_detail", kind: "detail", labels: ["une main", "one hand"] },
    { key: "one_arm_detail", kind: "detail", labels: ["un bras", "one arm"] }
];

const PROPOSALS = [
    {
        key: "lsit_to_vsit",
        from: "lsit_ex",
        to: "vsit_ex",
        context: "lsit_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.35,
        confidence: "medium",
        notes: "L-sit progression: L-sit -> V-sit"
    },
    {
        key: "vsit_to_manna",
        from: "vsit_ex",
        to: "manna_ex",
        context: "lsit_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.45,
        confidence: "medium",
        notes: "L-sit progression: V-sit -> Manna"
    },
    {
        key: "pushup_knees_to_pushup",
        from: "pushup_knees_ex",
        to: "pushup_ex",
        context: "pushup_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.3,
        confidence: "medium",
        notes: "Push-up progression: knees -> standard"
    },
    {
        key: "pushup_to_archer_pushup",
        from: "pushup_ex",
        to: "archer_pushup_ex",
        context: "pushup_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.35,
        confidence: "medium",
        notes: "Push-up progression: standard -> archer"
    },
    {
        key: "archer_pushup_to_assisted_one_arm_pushup",
        from: "archer_pushup_ex",
        to: "one_arm_assisted_pushup_ex",
        context: "pushup_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.25,
        confidence: "medium",
        notes: "Push-up progression: archer -> assisted one-arm"
    },
    {
        key: "assisted_one_arm_pushup_to_one_arm_pushup",
        from: "one_arm_assisted_pushup_ex",
        to: "one_arm_pushup_ex",
        context: "pushup_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.3,
        confidence: "medium",
        notes: "Push-up progression: assisted one-arm -> one-arm"
    },
    {
        key: "pullup_to_archer_pullup",
        from: "pullup_ex",
        to: "archer_pullup_ex",
        context: "pullup_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.35,
        confidence: "medium",
        notes: "Pull-up progression: standard -> archer"
    },
    {
        key: "archer_pullup_to_assisted_one_arm_pullup",
        from: "archer_pullup_ex",
        to: "one_arm_assisted_pullup_ex",
        context: "pullup_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.25,
        confidence: "medium",
        notes: "Pull-up progression: archer -> assisted one-arm"
    },
    {
        key: "assisted_one_arm_pullup_to_one_arm_pullup",
        from: "one_arm_assisted_pullup_ex",
        to: "one_arm_pullup_ex",
        context: "pullup_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.3,
        confidence: "medium",
        notes: "Pull-up progression: assisted one-arm -> one-arm"
    },
    {
        key: "dip_to_archer_dip",
        from: "dip_ex",
        to: "archer_dip_ex",
        context: "dip_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.35,
        confidence: "medium",
        notes: "Dip progression: standard -> archer"
    },
    {
        key: "archer_dip_to_assisted_one_arm_dip",
        from: "archer_dip_ex",
        to: "one_arm_assisted_dip_ex",
        context: "dip_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.25,
        confidence: "medium",
        notes: "Dip progression: archer -> assisted one-arm"
    },
    {
        key: "assisted_one_arm_dip_to_one_arm_dip",
        from: "one_arm_assisted_dip_ex",
        to: "one_arm_dip_ex",
        context: "dip_ex",
        isExerciseVariation: true,
        difficultyRatio: 1.3,
        confidence: "medium",
        notes: "Dip progression: assisted one-arm -> one-arm"
    },
    {
        key: "vertical_to_tuck_human_flag",
        from: "vertical_detail",
        to: "tuck_detail",
        context: "human_flag_ex",
        isExerciseVariation: false,
        difficultyRatio: 1.18,
        confidence: "low",
        notes: "Human flag micro progression: vertical -> tuck"
    },
    {
        key: "archer_detail_to_assisted_detail",
        from: "archer_detail",
        to: "assisted_detail",
        context: null,
        isExerciseVariation: false,
        difficultyRatio: 1.15,
        confidence: "low",
        notes: "Generic detail progression: archer -> assisted"
    },
    {
        key: "assisted_detail_to_one_hand_detail",
        from: "assisted_detail",
        to: "one_hand_detail",
        context: null,
        isExerciseVariation: false,
        difficultyRatio: 1.2,
        confidence: "low",
        notes: "Generic detail progression: assisted -> one hand"
    },
    {
        key: "one_hand_detail_to_one_arm_detail",
        from: "one_hand_detail",
        to: "one_arm_detail",
        context: null,
        isExerciseVariation: false,
        difficultyRatio: 1.05,
        confidence: "low",
        notes: "Generic detail progression: one hand -> one arm"
    }
];

// Overrides manuels pour lever les ambiguïtés de nom.
// Tu peux compléter cette map au fil des runs.
const PINNED_VARIATION_IDS = {
    lsit_ex: "669ced7e665a3ffe7771438a", // L-Sit (pas L-Sit Pull-Up)
    pushup_ex: "669ced7e665a3ffe7771437a", // Pompes
    one_arm_assisted_pushup_ex: "69fc6498bb3b26c6dcf898f5", // One Arm Push-Ups (Assisted)
    one_arm_pushup_ex: "6922144c1c858345acc2d095", // One arm pushup
    pullup_ex: "669ced7e665a3ffe77714379", // Tractions
    one_arm_pullup_ex: "6922144d1c858345acc2d138", // Traction un bras
    dip_ex: "669ced7e665a3ffe7771437b", // Dips
    human_flag_ex: "692214541c858345acc2d432", // Drapeau vertical (contexte figure)
    human_flag_tuck_ex: "692214541c858345acc2d435", // Drapeau tuck
    tuck_detail: "669c3609218324e0b7682b2b", // Tuck
    assisted_detail: "669c3609218324e0b7682ae6", // Assisté
    one_arm_assisted_pullup_ex: "692214531c858345acc2d3af", // Traction à un bras assistée
    one_hand_detail: "691ae56e9c28bf0f3ee1234c", // Un bras / une main
    one_arm_detail: "691ae56e9c28bf0f3ee1234c" // Un bras / une main
};

const ONE_ARM_PUSHUP_BASE_ID = "6922144c1c858345acc2d095";

function buildRegexes(labels) {
    return labels.map((label) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

function scoreCandidate(concept, doc) {
    const labels = concept.labels.map((x) => normalize(x));
    const joined = normalize(`${doc?.name?.fr || ""} ${doc?.name?.en || ""}`);
    let score = 0;
    for (const label of labels) {
        if (!label) continue;
        if (joined === label) score += 100;
        else if (joined.includes(label)) score += 20;
    }
    if (doc?.verified === true) score += 3;
    if (concept.kind === "exercise" && doc?.isExercice === true) score += 5;
    if (concept.kind === "detail" && doc?.isExercice === false) score += 5;
    return score;
}

async function fetchCandidatesForConcept(concept) {
    const pinnedId = PINNED_VARIATION_IDS[concept.key];
    if (pinnedId && mongoose.Types.ObjectId.isValid(pinnedId)) {
        const pinnedDoc = await Variation.findById(
            pinnedId,
            { _id: 1, name: 1, normalizedName: 1, isExercice: 1, verified: 1, popularity: 1, createdAt: 1 }
        ).lean();
        if (pinnedDoc) {
            const kindMatches = (
                (concept.kind === "exercise" && pinnedDoc?.isExercice === true)
                || (concept.kind === "detail" && pinnedDoc?.isExercice === false)
            );
            if (kindMatches) {
                return [{ doc: pinnedDoc, score: 1000, pinned: true }];
            }
        }
    }

    const regexes = buildRegexes(concept.labels);
    const nameOr = [];
    for (const regex of regexes) {
        nameOr.push({ "name.fr": regex });
        nameOr.push({ "name.en": regex });
        nameOr.push({ "normalizedName.fr": regex });
        nameOr.push({ "normalizedName.en": regex });
    }

    const query = { $or: nameOr };
    if (concept.kind === "exercise") query.isExercice = true;
    if (concept.kind === "detail") query.isExercice = false;

    const docs = await Variation.find(
        query,
        { _id: 1, name: 1, normalizedName: 1, isExercice: 1, verified: 1, popularity: 1, createdAt: 1 }
    )
        .sort({ verified: -1, createdAt: 1 })
        .lean();

    const scored = docs
        .map((doc) => ({ doc, score: scoreCandidate(concept, doc) }))
        .sort((a, b) => b.score - a.score);
    return scored;
}

function edgeKey(fromId, toId, contextId) {
    return `${String(fromId)}|${String(toId)}|${contextId ? String(contextId) : "null"}`;
}

async function applyMissingVariationCreations(creationProposals) {
    let created = 0;
    let alreadyExisting = 0;
    for (const proposal of creationProposals || []) {
        const payload = proposal?.suggestedPayload;
        if (!payload?.normalizedName?.fr || !payload?.normalizedName?.en) continue;
        const existing = await Variation.findOne(
            {
                "normalizedName.fr": payload.normalizedName.fr,
                "normalizedName.en": payload.normalizedName.en
            },
            { _id: 1 }
        ).lean();
        if (existing) {
            alreadyExisting += 1;
            continue;
        }
        await Variation.create(payload);
        created += 1;
    }
    return { created, alreadyExisting };
}

async function buildMissingVariationCreationProposals(conceptMatches) {
    const out = [];
    const assistedPushupMatch = conceptMatches.get("one_arm_assisted_pushup_ex");
    const assistedPushupMissing = !assistedPushupMatch || (assistedPushupMatch.candidates || []).length === 0;
    if (!assistedPushupMissing) return out;

    if (!mongoose.Types.ObjectId.isValid(ONE_ARM_PUSHUP_BASE_ID)) return out;
    const base = await Variation.findById(
        ONE_ARM_PUSHUP_BASE_ID,
        {
            _id: 1,
            type: 1,
            selfmade: 1,
            megatype: 1,
            isExercice: 1,
            isUnilateral: 1,
            muscles: 1,
            weightType: 1,
            includeBodyweight: 1,
            exerciseBodyWeightRatio: 1,
            picture: 1,
            popularity: 1,
            possibleProgression: 1,
            verified: 1
        }
    ).lean();
    if (!base) return out;

    const assistedDetail = conceptMatches.get("assisted_detail")?.selected?.doc || null;
    const pushupBase = conceptMatches.get("pushup_ex")?.selected?.doc || null;

    out.push({
        key: "create_one_arm_assisted_pushup_ex",
        reason: "Concept one_arm_assisted_pushup_ex introuvable dans la base.",
        basedOn: describeVariation(base),
        suggestedPayload: {
            type: base.type,
            selfmade: base.selfmade,
            megatype: base.megatype,
            isExercice: true,
            isUnilateral: base.isUnilateral === true,
            muscles: base.muscles,
            weightType: base.weightType,
            includeBodyweight: base.includeBodyweight,
            exerciseBodyWeightRatio: base.exerciseBodyWeightRatio,
            picture: base.picture,
            popularity: base.popularity,
            verified: true,
            possibleProgression: true,
            name: {
                fr: "Pompes à un bras assistées",
                en: "One Arm Push-Ups (Assisted)"
            },
            normalizedName: {
                fr: "pompes a un bras assistees",
                en: "one arm push ups assisted"
            },
            // Proposition: variante dérivée de la one-arm pushup + détail Assisté.
            equivalentTo: [
                toObjectId(base._id),
                ...(assistedDetail ? [toObjectId(assistedDetail._id)] : [])
            ],
            metaHints: {
                pushupBaseVariationId: pushupBase ? String(pushupBase._id) : null,
                oneArmPushupBaseVariationId: String(base._id),
                assistedDetailVariationId: assistedDetail ? String(assistedDetail._id) : null,
                searchAliases: [
                    "pompe une main assistée",
                    "pompes un bras assistées",
                    "assisted one arm push-up",
                    "assisted one-arm push-up",
                    "one arm push up assisted"
                ]
            }
        }
    });
    return out;
}

async function run() {
    const shouldApply = process.argv.includes("--apply");
    const shouldApplyCreateMissing = process.argv.includes("--apply-create-missing");
    await mongoose.connect(getMongoUri());

    const conceptMatches = new Map();
    for (const concept of CONCEPTS) {
        const candidates = await fetchCandidatesForConcept(concept);
        conceptMatches.set(concept.key, {
            concept,
            candidates,
            selected: candidates[0] || null,
            isAmbiguous: candidates.length > 1 && candidates[0].score === candidates[1].score
        });
    }

    console.log("=== 1.a Exercices trouvés ===");
    for (const item of CONCEPTS.filter((c) => c.kind === "exercise")) {
        const m = conceptMatches.get(item.key);
        const preview = (m.candidates || []).slice(0, 5).map((x) => ({
            score: x.score,
            ...describeVariation(x.doc)
        }));
        console.log(`\n[${item.key}] labels=${item.labels.join(" | ")}`);
        console.log(preview);
    }

    console.log("\n=== 1.b Détails trouvés ===");
    for (const item of CONCEPTS.filter((c) => c.kind === "detail")) {
        const m = conceptMatches.get(item.key);
        const preview = (m.candidates || []).slice(0, 5).map((x) => ({
            score: x.score,
            ...describeVariation(x.doc)
        }));
        console.log(`\n[${item.key}] labels=${item.labels.join(" | ")}`);
        console.log(preview);
    }

    const existingEdges = await VariationProgressionEdge.find(
        { isActive: true },
        { fromVariationId: 1, toVariationId: 1, contextVariationId: 1 }
    ).lean();
    const existingSet = new Set(
        existingEdges.map((e) => edgeKey(e.fromVariationId, e.toVariationId, e.contextVariationId))
    );

    const proposed = [];
    for (const proposal of PROPOSALS) {
        const from = conceptMatches.get(proposal.from);
        const to = conceptMatches.get(proposal.to);
        const context = proposal.context ? conceptMatches.get(proposal.context) : null;

        const resolvedFrom = from?.selected?.doc || null;
        const resolvedTo = to?.selected?.doc || null;
        const resolvedContext = context?.selected?.doc || null;
        const canResolve = Boolean(
            resolvedFrom
            && resolvedTo
            && (!proposal.context || resolvedContext)
            && !from?.isAmbiguous
            && !to?.isAmbiguous
            && (!context || !context?.isAmbiguous)
            && String(resolvedFrom._id) !== String(resolvedTo._id)
        );

        const key = canResolve
            ? edgeKey(
                resolvedFrom._id,
                resolvedTo._id,
                resolvedContext ? resolvedContext._id : null
            )
            : null;
        const existsAlready = key ? existingSet.has(key) : false;

        proposed.push({
            proposal,
            canResolve,
            existsAlready,
            from: resolvedFrom ? describeVariation(resolvedFrom) : null,
            to: resolvedTo ? describeVariation(resolvedTo) : null,
            context: resolvedContext ? describeVariation(resolvedContext) : null
        });
    }

    console.log("\n=== 1.c Propositions d'insertions individuelles ===");
    for (const p of proposed) {
        console.log({
            key: p.proposal.key,
            canResolve: p.canResolve,
            existsAlready: p.existsAlready,
            from: p.from,
            to: p.to,
            context: p.context,
            isExerciseVariation: p.proposal.isExerciseVariation,
            difficultyRatio: p.proposal.difficultyRatio,
            confidence: p.proposal.confidence,
            notes: p.proposal.notes
        });
    }

    const applicable = proposed.filter((p) => p.canResolve && !p.existsAlready);
    const creationProposals = await buildMissingVariationCreationProposals(conceptMatches);
    if (creationProposals.length > 0) {
        console.log("\n=== Propositions de création de variations manquantes ===");
        console.log(creationProposals);
    }
    if (shouldApplyCreateMissing && creationProposals.length > 0) {
        const creationResult = await applyMissingVariationCreations(creationProposals);
        console.log("\n=== Apply Create Missing Result ===");
        console.log(creationResult);
    }
    console.log("\n=== Résumé ===");
    console.log({
        applyMode: shouldApply,
        applyCreateMissingMode: shouldApplyCreateMissing,
        proposalCount: proposed.length,
        resolvableCount: proposed.filter((p) => p.canResolve).length,
        alreadyExistingCount: proposed.filter((p) => p.existsAlready).length,
        readyToInsertCount: applicable.length,
        missingVariationCreationProposals: creationProposals.length
    });

    if (shouldApply) {
        let upserted = 0;
        for (const p of applicable) {
            const edgePayload = {
                fromVariationId: toObjectId(p.from._id),
                fromVariationName: p.from.nameFr || p.from.nameEn || "",
                toVariationId: toObjectId(p.to._id),
                toVariationName: p.to.nameFr || p.to.nameEn || "",
                isExerciseVariation: p.proposal.isExerciseVariation,
                difficultyRatio: p.proposal.difficultyRatio,
                confidence: p.proposal.confidence,
                source: "manual",
                contextVariationId: p.context ? toObjectId(p.context._id) : null,
                notes: p.proposal.notes,
                isActive: true
            };
            await VariationProgressionEdge.updateOne(
                {
                    fromVariationId: edgePayload.fromVariationId,
                    toVariationId: edgePayload.toVariationId,
                    contextVariationId: edgePayload.contextVariationId
                },
                { $set: edgePayload },
                { upsert: true }
            );
            upserted += 1;
        }
        console.log("\n=== Apply Result ===");
        console.log({ upserted });
    } else {
        console.log("\nDry-run uniquement. Utiliser --apply pour insérer les edges.");
    }
}

run()
    .catch(async (err) => {
        console.error("proposeExerciseSpecificProgressionEdges failed:", err);
        process.exitCode = 1;
        try { await mongoose.disconnect(); } catch (_) {}
    })
    .finally(async () => {
        try { await mongoose.disconnect(); } catch (_) {}
    });
