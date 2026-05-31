/**
 * Suggestions de programme multi-critères (Dernière séance, Cycle, Variété).
 *
 * Limites connues :
 * - Les séances « partir de zéro » (sans programme) affaiblissent la détection de cycle.
 * - Le fallback dossier suppose que l'ordre createdAt reflète la rotation réelle.
 */
const mongoose = require('mongoose');
const UserProgram = require('../schema/userProgram');
const Seance = require('../schema/seance');

const HISTORY_LIMIT = 30;
const MIN_CYCLE_LENGTH = 2;
const MAX_CYCLE_LENGTH = 5;
const MIN_CYCLE_REPETITIONS = 2;
const VARIETY_MIN_SEANCES = 3;
const VARIETY_MIN_DAYS = 7;
const VARIETY_MAX_DAYS = 45;
const VARIETY_WINDOW_DAYS = 90;
const MAX_SUGGESTIONS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toId(value) {
    if (!value) return null;
    return String(value._id || value);
}

function sequencesEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]);
}

/**
 * Détecte un cycle répété (ex. A,B,C,A,B,C) dans la séquence chronologique de programIds.
 * @returns {{ pattern: string[], nextProgramId: string, repetitions: number } | null}
 */
function detectRepeatingCycle(programIds) {
    if (!Array.isArray(programIds) || programIds.length < MIN_CYCLE_LENGTH * MIN_CYCLE_REPETITIONS) {
        return null;
    }

    let best = null;

    for (let cycleLength = MIN_CYCLE_LENGTH; cycleLength <= MAX_CYCLE_LENGTH; cycleLength += 1) {
        const windowSize = cycleLength * MIN_CYCLE_REPETITIONS;
        if (programIds.length < windowSize) continue;

        const window = programIds.slice(-windowSize);
        const firstHalf = window.slice(0, cycleLength);
        const secondHalf = window.slice(cycleLength, windowSize);

        if (!sequencesEqual(firstHalf, secondHalf)) continue;

        let repetitions = MIN_CYCLE_REPETITIONS;
        for (let start = programIds.length - windowSize - cycleLength; start >= 0; start -= cycleLength) {
            const chunk = programIds.slice(start, start + cycleLength);
            if (sequencesEqual(chunk, firstHalf)) {
                repetitions += 1;
            } else {
                break;
            }
        }

        const candidate = {
            pattern: firstHalf,
            repetitions,
            cycleLength,
        };

        if (
            !best
            || candidate.repetitions > best.repetitions
            || (candidate.repetitions === best.repetitions && candidate.cycleLength > best.cycleLength)
        ) {
            best = candidate;
        }
    }

    if (!best) return null;

    const lastId = programIds[programIds.length - 1];
    const lastIndex = best.pattern.lastIndexOf(lastId);
    if (lastIndex === -1) return null;

    const nextIndex = (lastIndex + 1) % best.pattern.length;
    return {
        pattern: best.pattern,
        nextProgramId: best.pattern[nextIndex],
        repetitions: best.repetitions,
        reason: `${best.pattern.join('→')} (${best.repetitions}x)`,
    };
}

/**
 * Rotation implicite dans un dossier : programme suivant après le dernier utilisé.
 */
function detectFolderRotation(folderProgramIds, lastUsedProgramId) {
    if (!Array.isArray(folderProgramIds) || folderProgramIds.length < 2) return null;

    const ids = folderProgramIds.map(toId).filter(Boolean);
    if (ids.length < 2) return null;

    const lastId = toId(lastUsedProgramId);
    const lastIndex = lastId ? ids.indexOf(lastId) : -1;
    const nextIndex = lastIndex >= 0 ? (lastIndex + 1) % ids.length : 0;

    return {
        nextProgramId: ids[nextIndex],
        reason: 'folder rotation',
    };
}

/**
 * Choisit un programme « variété » : fréquent récemment mais pas fait depuis un moment.
 */
function pickVarietySuggestion(candidates, excludeIds, now = new Date()) {
    const excluded = new Set((excludeIds || []).map(toId).filter(Boolean));
    const nowMs = now.getTime();

    let best = null;

    for (const candidate of candidates || []) {
        const programId = toId(candidate._id || candidate.programId);
        if (!programId || excluded.has(programId)) continue;
        if (candidate.isArchived) continue;

        const seanceCount = candidate.seanceCount90d ?? candidate.seanceCount ?? 0;
        if (seanceCount < VARIETY_MIN_SEANCES) continue;

        const lastDate = candidate.lastSeanceDate ? new Date(candidate.lastSeanceDate) : null;
        if (!lastDate || Number.isNaN(lastDate.getTime())) continue;

        const daysSince = (nowMs - lastDate.getTime()) / MS_PER_DAY;
        if (daysSince < VARIETY_MIN_DAYS || daysSince > VARIETY_MAX_DAYS) continue;

        const score = seanceCount / daysSince;
        if (!best || score > best.score) {
            best = { programId, score, daysSince, seanceCount };
        }
    }

    return best;
}

function buildSuggestion(type, program, extra = {}) {
    if (!program) return null;
    const programId = toId(program._id || program.programId);
    if (!programId) return null;

    const seance = extra.seance
        || (extra.lastSeanceDate ? { date: extra.lastSeanceDate } : null);

    return {
        type,
        programId,
        name: program.name || extra.name || '',
        initials: program.initials || null,
        color: program.color || null,
        ...(extra.lastSeanceId ? { lastSeanceId: extra.lastSeanceId } : {}),
        ...(seance ? { seance } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
    };
}

function dedupeSuggestions(suggestions, maxCount = MAX_SUGGESTIONS) {
    const seen = new Set();
    const result = [];

    for (const item of suggestions) {
        if (!item?.programId) continue;
        const id = toId(item.programId);
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(item);
        if (result.length >= maxCount) break;
    }

    return result;
}

function buildLastSuggestion(lastSeance) {
    if (!lastSeance) return null;

    const program = lastSeance.program && typeof lastSeance.program === 'object'
        ? lastSeance.program
        : null;

    return buildSuggestion('last', program || {
        _id: lastSeance.program,
        name: lastSeance.name,
    }, {
        lastSeanceId: lastSeance._id,
        seance: {
            _id: lastSeance._id,
            date: lastSeance.date,
            title: lastSeance.title,
            description: lastSeance.description,
            name: lastSeance.name,
        },
    });
}

function resolveDominantFolder(recentSeancesWithProgram) {
    const counts = new Map();

    for (const seance of recentSeancesWithProgram) {
        const program = seance.program;
        if (!program || typeof program !== 'object') continue;
        if (program.isArchived) continue;

        const folderId = toId(program.folder);
        if (!folderId) continue;

        counts.set(folderId, (counts.get(folderId) || 0) + 1);
    }

    let dominantFolderId = null;
    let maxCount = 0;

    for (const [folderId, count] of counts.entries()) {
        if (count > maxCount) {
            maxCount = count;
            dominantFolderId = folderId;
        }
    }

    return dominantFolderId;
}

async function computeProgramSuggestions(userId) {
    const now = new Date();
    const varietyWindowStart = new Date(now.getTime() - VARIETY_WINDOW_DAYS * MS_PER_DAY);

    const [lastSeance, recentSeances, varietyStats, programLastDates, activePrograms] = await Promise.all([
        Seance.findOne({ user: userId })
            .sort({ date: -1 })
            .select('date title description _id name program')
            .populate('program', 'name initials color folder isArchived')
            .lean(),
        Seance.find({
            user: userId,
            program: { $ne: null },
        })
            .sort({ date: -1 })
            .limit(HISTORY_LIMIT)
            .select('date program')
            .populate('program', 'name initials color folder isArchived')
            .lean(),
        Seance.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    program: { $ne: null },
                    date: { $gte: varietyWindowStart },
                },
            },
            {
                $group: {
                    _id: '$program',
                    seanceCount90d: { $sum: 1 },
                    lastSeanceDate: { $max: '$date' },
                },
            },
        ]),
        Seance.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    program: { $ne: null },
                },
            },
            {
                $group: {
                    _id: '$program',
                    lastSeanceDate: { $max: '$date' },
                },
            },
        ]),
        UserProgram.find({ user: userId, isArchived: false })
            .select('name initials color folder isArchived createdAt')
            .lean(),
    ]);

    if (!lastSeance) {
        return { suggestions: [] };
    }

    const programById = new Map(activePrograms.map((p) => [toId(p._id), p]));
    const varietyStatsMap = new Map(
        varietyStats.map((row) => [toId(row._id), row]),
    );
    const lastDateByProgramId = new Map(
        programLastDates.map((row) => [toId(row._id), row.lastSeanceDate]),
    );

    const nonArchivedRecent = recentSeances.filter((s) => {
        const prog = s.program;
        return prog && typeof prog === 'object' && !prog.isArchived;
    });

    const chronologicalIds = [...nonArchivedRecent]
        .reverse()
        .map((s) => toId(s.program))
        .filter(Boolean);

    const lastSuggestion = buildLastSuggestion(lastSeance);
    const excludeIds = [];

    if (lastSuggestion?.programId) {
        excludeIds.push(lastSuggestion.programId);
    }

    let cycleSuggestion = null;
    const cycleResult = detectRepeatingCycle(chronologicalIds);

    if (cycleResult?.nextProgramId) {
        const program = programById.get(cycleResult.nextProgramId)
            || nonArchivedRecent.find((s) => toId(s.program) === cycleResult.nextProgramId)?.program;

        if (program && !program.isArchived) {
            cycleSuggestion = buildSuggestion('cycle', program, {
                reason: cycleResult.reason,
                lastSeanceDate: lastDateByProgramId.get(cycleResult.nextProgramId),
            });
        }
    }

    if (!cycleSuggestion) {
        const dominantFolderId = resolveDominantFolder(nonArchivedRecent);
        if (dominantFolderId) {
            const folderPrograms = activePrograms
                .filter((p) => toId(p.folder) === dominantFolderId)
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            const lastUsedInFolder = nonArchivedRecent.find(
                (s) => toId(s.program?.folder) === dominantFolderId,
            );

            const folderRotation = detectFolderRotation(
                folderPrograms.map((p) => p._id),
                lastUsedInFolder ? toId(lastUsedInFolder.program) : null,
            );

            if (folderRotation?.nextProgramId) {
                const program = programById.get(folderRotation.nextProgramId);
                if (program && !excludeIds.includes(folderRotation.nextProgramId)) {
                    cycleSuggestion = buildSuggestion('cycle', program, {
                        reason: folderRotation.reason,
                        lastSeanceDate: lastDateByProgramId.get(folderRotation.nextProgramId),
                    });
                }
            }
        }
    }

    if (cycleSuggestion?.programId) {
        excludeIds.push(cycleSuggestion.programId);
    }

    const varietyCandidates = activePrograms.map((program) => {
        const stats = varietyStatsMap.get(toId(program._id));
        return {
            ...program,
            seanceCount90d: stats?.seanceCount90d || 0,
            lastSeanceDate: stats?.lastSeanceDate || null,
        };
    });

    const varietyPick = pickVarietySuggestion(varietyCandidates, excludeIds, now);
    let varietySuggestion = null;

    if (varietyPick?.programId) {
        const program = programById.get(varietyPick.programId);
        if (program) {
            varietySuggestion = buildSuggestion('variety', program, {
                reason: `${varietyPick.seanceCount} séances, il y a ${Math.round(varietyPick.daysSince)}j`,
                lastSeanceDate: lastDateByProgramId.get(varietyPick.programId),
            });
        }
    }

    const suggestions = dedupeSuggestions(
        [lastSuggestion, cycleSuggestion, varietySuggestion].filter(Boolean),
        MAX_SUGGESTIONS,
    );

    return { suggestions };
}

module.exports = {
    detectRepeatingCycle,
    detectFolderRotation,
    pickVarietySuggestion,
    buildLastSuggestion,
    dedupeSuggestions,
    computeProgramSuggestions,
    MAX_SUGGESTIONS,
    VARIETY_MIN_DAYS,
    VARIETY_MAX_DAYS,
};
