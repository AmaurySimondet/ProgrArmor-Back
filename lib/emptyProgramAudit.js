/**
 * Logique pure pour auditer les programmes « présents mais vides » côté UI.
 * Reproduit ProgramQuickStartModal + chemins RecordWorkoutPicker.
 */

function toId(value) {
    if (!value) return null;
    return String(value._id || value);
}

/**
 * Même filtre que ProgramQuickStartModal (l.58) :
 * row visible si variations résolues OU variationName présent.
 */
function isTemplateEntryVisibleInQuickStart(entry, variationExistsById = new Map()) {
    if (!entry) return false;

    const variationIds = Array.isArray(entry.variationIds) ? entry.variationIds : [];
    const hasVariationName = Boolean(
        entry?.variationName?.fr
        || entry?.variationName?.en
        || entry?.mergedVariationsNames?.fr
        || entry?.mergedVariationsNames?.en,
    );

    if (variationIds.length === 0) {
        return hasVariationName;
    }

    const resolvedCount = variationIds.filter((id) => variationExistsById.get(toId(id))).length;
    return resolvedCount > 0 || hasVariationName;
}

/**
 * Simule l'affichage de ProgramQuickStartModal après getProgram.
 */
function simulateQuickStartModal(program, {
    variationExistsById = new Map(),
    lastSeanceSetCount = null,
} = {}) {
    const template = Array.isArray(program?.program) ? program.program : [];
    const visibleRows = template.filter((entry) => isTemplateEntryVisibleInQuickStart(entry, variationExistsById));

    const lastSeanceId = program?.lastSeance?._id || program?.lastSeanceId || null;
    const hasLastSeanceButton = Boolean(lastSeanceId);
    const seanceCount = program?.seanceCount ?? 0;

    const wouldStartFromProgramWithExercises = visibleRows.length > 0;
    const wouldStartFromLastWithExercises = hasLastSeanceButton
        && (lastSeanceSetCount == null ? seanceCount > 0 : lastSeanceSetCount > 0);

    return {
        templateEntryCount: template.length,
        visibleExerciseRowCount: visibleRows.length,
        appearsEmptyInModal: visibleRows.length === 0,
        hasLastSeanceButton,
        wouldStartFromProgramWithExercises,
        wouldStartFromLastWithExercises,
        userPerceivesAsBroken: visibleRows.length === 0 && !wouldStartFromLastWithExercises,
    };
}

/**
 * Simule programTemplateToWorkoutExercises : garde uniquement les entrées
 * dont au moins une variation existe en base.
 */
function simulateProgramTemplateToWorkoutExercises(programTemplate = [], variationExistsById = new Map()) {
    if (!Array.isArray(programTemplate)) return [];

    return programTemplate.filter((entry) => {
        const variationIds = Array.isArray(entry?.variationIds) ? entry.variationIds : [];
        if (variationIds.length === 0) return false;
        return variationIds.some((id) => variationExistsById.get(toId(id)));
    });
}

const ISSUE = {
    EMPTY_TEMPLATE_WITH_SEANCES: 'EMPTY_TEMPLATE_WITH_SEANCES',
    TEMPLATE_UNRESOLVABLE: 'TEMPLATE_UNRESOLVABLE',
    MISSING_LAST_SEANCE_ID: 'MISSING_LAST_SEANCE_ID',
    STALE_LAST_SEANCE_ID: 'STALE_LAST_SEANCE_ID',
    LAST_SEANCE_WITHOUT_SETS: 'LAST_SEANCE_WITHOUT_SETS',
    SUGGESTION_METADATA_ONLY: 'SUGGESTION_METADATA_ONLY',
    HEALTHY: 'HEALTHY',
};

function classifyProgram(program, context = {}) {
    const {
        seanceCount = 0,
        variationExistsById = new Map(),
        lastSeanceExists = true,
        lastSeanceSetCount = 0,
        fromSuggestionOnly = false,
    } = context;

    const template = Array.isArray(program?.program) ? program.program : [];
    const quickStart = simulateQuickStartModal(program, {
        variationExistsById,
        lastSeanceSetCount,
    });
    const resolvedExercises = simulateProgramTemplateToWorkoutExercises(template, variationExistsById);

    const issues = [];

    if (seanceCount > 0 && template.length === 0) {
        issues.push(ISSUE.EMPTY_TEMPLATE_WITH_SEANCES);
    }

    if (template.length > 0 && resolvedExercises.length === 0) {
        issues.push(ISSUE.TEMPLATE_UNRESOLVABLE);
    }

    if (seanceCount > 0 && !program?.lastSeanceId && !program?.lastSeance?._id) {
        issues.push(ISSUE.MISSING_LAST_SEANCE_ID);
    }

    if (program?.lastSeanceId && lastSeanceExists === false) {
        issues.push(ISSUE.STALE_LAST_SEANCE_ID);
    }

    if (seanceCount > 0 && lastSeanceSetCount === 0) {
        issues.push(ISSUE.LAST_SEANCE_WITHOUT_SETS);
    }

    if (fromSuggestionOnly && quickStart.userPerceivesAsBroken) {
        issues.push(ISSUE.SUGGESTION_METADATA_ONLY);
    }

    if (issues.length === 0) {
        return { issues: [ISSUE.HEALTHY], quickStart, resolvedExerciseCount: resolvedExercises.length };
    }

    return { issues, quickStart, resolvedExerciseCount: resolvedExercises.length };
}

function summarizeIssues(programsAudit) {
    const counts = {};
    for (const row of programsAudit) {
        for (const issue of row.issues) {
            counts[issue] = (counts[issue] || 0) + 1;
        }
    }
    return counts;
}

module.exports = {
    ISSUE,
    toId,
    isTemplateEntryVisibleInQuickStart,
    simulateQuickStartModal,
    simulateProgramTemplateToWorkoutExercises,
    classifyProgram,
    summarizeIssues,
};
