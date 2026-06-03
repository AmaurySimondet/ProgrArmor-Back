const mongoose = require('mongoose');
const { getVariationBySearch, getVariationById } = require('./variation');

const SETS_PER_EXERCISE = 4;
const REPS_PER_SET = 12;

/** IDs catalogue validés (remplace les recherches Atlas ambiguës). */
const V = {
    ROWING_PENCHE: '6922144b1c858345acc2d04b',
    DEV_MILITAIRE: '669ced7e665a3ffe77714369',
    DC_INCLINE_HALTERES: '6922144b1c858345acc2d048',
    EXTENSION_TRICEPS: '6922144c1c858345acc2d079',
    FENTES_HALTERES: '6922144c1c858345acc2d0d1',
    ELEVATIONS_LAT_HALTERES: '6922144b1c858345acc2d060',
    ROWING_HALTERES: '6922144b1c858345acc2d06f',
    FACE_PULL: '669ced7e665a3ffe7771436e',
    LEG_CURL_ALONGE: '6922144c1c858345acc2d0b3',
    SDT_JAMBE_TENDU: '6922144d1c858345acc2d11d',
    PRESSE_INCLINEE: '6922144b1c858345acc2d042',
    ECARTE_HALTERE: '6922144c1c858345acc2d0c2',
    ROWING_POULIE: '6922144c1c858345acc2d07f',
    DEV_ARNOLD: '6922144d1c858345acc2d11a',
    OISEAU: '669ced7e665a3ffe77714372',
    CURL_HALTERE: '6922144b1c858345acc2d03e',
    CURL_PUPITRE: '6922144c1c858345acc2d0a3',
    BARRE_AU_FRONT: '669ced7e665a3ffe77714370',
    CURL_MARTEAU: '6922144c1c858345acc2d07c',
    CURL_BICEPS_BARRE: '6922144b1c858345acc2d045',
};

const id = (variationId) => ({ variationId });
const search = (query) => ({ search: query });

/** @type {Map<string, object[]>} */
const resolvedProgramCache = new Map();

const PROGRAM_EXAMPLES = [
    {
        id: 'full-body',
        name: 'Full body',
        initials: 'FB',
        color: '#ffe0ed',
        exercises: [
            search('Squat barre'),
            search('Développé couché barre'),
            id(V.ROWING_PENCHE),
            id(V.DEV_MILITAIRE),
            id(V.CURL_BICEPS_BARRE),
            id(V.EXTENSION_TRICEPS),
            id(V.FENTES_HALTERES),
        ],
    },
    {
        id: 'push',
        name: 'Push',
        initials: 'PUS',
        color: '#fff9e0',
        exercises: [
            search('Développé couché barre'),
            id(V.DC_INCLINE_HALTERES),
            id(V.DEV_MILITAIRE),
            id(V.ELEVATIONS_LAT_HALTERES),
            search('Dips'),
            id(V.EXTENSION_TRICEPS),
        ],
    },
    {
        id: 'pull',
        name: 'Pull',
        initials: 'PUL',
        color: '#edffd9',
        exercises: [
            search('Tractions pronation'),
            id(V.ROWING_PENCHE),
            id(V.ROWING_HALTERES),
            id(V.CURL_BICEPS_BARRE),
            id(V.FACE_PULL),
            search('Tirage vertical prise large'),
        ],
    },
    {
        id: 'legs',
        name: 'Legs',
        initials: 'LEG',
        color: '#f5e6ff',
        exercises: [
            search('Squat barre'),
            id(V.PRESSE_INCLINEE),
            id(V.SDT_JAMBE_TENDU),
            id(V.LEG_CURL_ALONGE),
            id(V.FENTES_HALTERES),
            search('Mollets debout'),
        ],
    },
    {
        id: 'split-pecs',
        name: 'Split 1 – Pectoraux',
        initials: 'P1',
        color: '#e6f9fa',
        exercises: [
            search('Développé couché barre'),
            id(V.DC_INCLINE_HALTERES),
            id(V.ECARTE_HALTERE),
            search('Dips'),
        ],
    },
    {
        id: 'split-back',
        name: 'Split 2 – Dos',
        initials: 'P2',
        color: '#e6fff6',
        exercises: [
            search('Tractions pronation'),
            id(V.ROWING_PENCHE),
            id(V.ROWING_HALTERES),
            search('Tirage vertical'),
            id(V.ROWING_POULIE),
        ],
    },
    {
        id: 'split-shoulders',
        name: 'Split 3 – Épaules',
        initials: 'P3',
        color: '#ffe0ed',
        exercises: [
            id(V.DEV_MILITAIRE),
            id(V.DEV_ARNOLD),
            id(V.ELEVATIONS_LAT_HALTERES),
            id(V.OISEAU),
            id(V.FACE_PULL),
        ],
    },
    {
        id: 'split-legs',
        name: 'Split 4 – Jambes',
        initials: 'P4',
        color: '#fff9e0',
        exercises: [
            search('Squat barre'),
            id(V.PRESSE_INCLINEE),
            id(V.SDT_JAMBE_TENDU),
            id(V.LEG_CURL_ALONGE),
            id(V.FENTES_HALTERES),
            search('Mollets debout'),
        ],
    },
    {
        id: 'split-arms',
        name: 'Split 5 – Bras',
        initials: 'P5',
        color: '#edffd9',
        exercises: [
            id(V.CURL_BICEPS_BARRE),
            id(V.CURL_HALTERE),
            id(V.CURL_PUPITRE),
            id(V.EXTENSION_TRICEPS),
            id(V.BARRE_AU_FRONT),
            id(V.CURL_MARTEAU),
        ],
    },
];

function buildExampleSets() {
    return Array.from({ length: SETS_PER_EXERCISE }, () => ({
        unit: 'repetitions',
        value: REPS_PER_SET,
        weightLoad: 0,
    }));
}

function getExampleDefinition(exampleId) {
    const slug = String(exampleId || '').trim();
    const def = PROGRAM_EXAMPLES.find((entry) => entry.id === slug);
    if (!def) throw new Error('Unknown program example');
    return def;
}

function getExerciseCount(definition) {
    return definition?.exercises?.length || 0;
}

async function resolveVariationForQuery(searchQuery, { searchFn = getVariationBySearch } = {}) {
    const { variations } = await searchFn(
        searchQuery,
        null,
        'popularity',
        1,
        1,
        true,
        true
    );
    const variation = variations?.[0];
    if (!variation?._id) {
        throw new Error(`No variation found for query: ${searchQuery}`);
    }
    return variation;
}

async function resolveVariationById(variationId, { getByIdFn = getVariationById } = {}) {
    const idStr = String(variationId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(idStr)) {
        throw new Error(`Invalid variation id: ${variationId}`);
    }
    const variation = await getByIdFn(idStr, ['name']);
    if (!variation?._id) {
        throw new Error(`Variation not found: ${variationId}`);
    }
    return variation;
}

async function resolveExerciseRef(exerciseRef, options = {}) {
    if (exerciseRef?.variationId) {
        return resolveVariationById(exerciseRef.variationId, options);
    }
    if (exerciseRef?.search) {
        return resolveVariationForQuery(exerciseRef.search, options);
    }
    throw new Error('Exercise ref must have variationId or search');
}

function buildProgramExerciseFromVariation(variation) {
    const name = variation.name || { fr: '', en: '' };
    const variationId = variation._id;
    return {
        variationIds: [variationId],
        variationName: {
            fr: name.fr || '',
            en: name.en || '',
        },
        mergedVariationsNames: {
            fr: name.fr || '',
            en: name.en || '',
        },
        sets: buildExampleSets(),
    };
}

async function resolveProgramTemplateForDefinition(definition, options = {}) {
    const cacheKey = definition.id;
    if (resolvedProgramCache.has(cacheKey)) {
        return resolvedProgramCache.get(cacheKey);
    }

    const program = [];
    for (const exerciseRef of definition.exercises) {
        const variation = await resolveExerciseRef(exerciseRef, options);
        program.push(buildProgramExerciseFromVariation(variation));
    }

    resolvedProgramCache.set(cacheKey, program);
    return program;
}

function clearResolvedProgramCache() {
    resolvedProgramCache.clear();
}

async function resolveProgramExample(definition, options = {}) {
    const program = await resolveProgramTemplateForDefinition(definition, options);
    return {
        id: definition.id,
        name: definition.name,
        initials: definition.initials,
        color: definition.color,
        program,
        exerciseCount: program.length,
    };
}

async function getProgramExamples(options = {}) {
    const examples = await Promise.all(
        PROGRAM_EXAMPLES.map((def) => resolveProgramExample(def, options))
    );
    return examples;
}

async function getProgramExampleById(exampleId, options = {}) {
    const definition = getExampleDefinition(exampleId);
    return resolveProgramExample(definition, options);
}

module.exports = {
    V,
    PROGRAM_EXAMPLES,
    SETS_PER_EXERCISE,
    REPS_PER_SET,
    buildExampleSets,
    getExampleDefinition,
    getExerciseCount,
    resolveVariationForQuery,
    resolveVariationById,
    resolveExerciseRef,
    buildProgramExerciseFromVariation,
    resolveProgramTemplateForDefinition,
    clearResolvedProgramCache,
    getProgramExamples,
    getProgramExampleById,
};
