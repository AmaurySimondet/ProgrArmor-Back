const mongoose = require("mongoose");
const Success = require("../schema/success");
const UserSuccess = require("../schema/usersuccess");
const Seance = require("../schema/seance");
const Seanceset = require("../schema/seanceset");
const Variation = require("../schema/variation");
const AwsImage = require("../schema/awsImage");
const User = require("../schema/schemaUser");
const { getEffectiveLoad } = require("../utils/set");
const { secondsToEquivalentReps } = require("../utils/oneRepMax");

const globalCache = global;
if (!globalCache.__successTtlCache) {
    globalCache.__successTtlCache = new Map();
}
const successTtlCache = globalCache.__successTtlCache;

function toObjectId(value) {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(value);
    return null;
}

function parseDelimitedIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.map(v => v.toString()).filter(Boolean);
    }
    return String(value)
        .split("|")
        .map(v => v.trim())
        .filter(Boolean);
}

function getSetRepsEquivalent(setDoc) {
    const raw = Number(setDoc?.value || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (setDoc?.unit === "seconds") {
        return secondsToEquivalentReps(raw);
    }
    return raw;
}

function inTimeWindow(date, start, end) {
    if (!start || !end || !date) return false;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    if (![sh, sm, eh, em].every(Number.isFinite)) return false;

    const current = date.getHours() * 60 + date.getMinutes();
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin <= endMin) {
        return current >= startMin && current <= endMin;
    }
    return current >= startMin || current <= endMin;
}

function getWeekIndex(date) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    return Math.floor(date.getTime() / (7 * oneDayMs));
}

function computeCurrentWeekStreak(seances) {
    if (!Array.isArray(seances) || seances.length === 0) return 0;
    const uniqueWeeks = [...new Set(seances.map(s => getWeekIndex(new Date(s.date))))].sort((a, b) => a - b);
    const currentWeekIndex = getWeekIndex(new Date());
    const lastWorkoutWeek = uniqueWeeks[uniqueWeeks.length - 1];
    if (lastWorkoutWeek < currentWeekIndex - 1) return 0;

    let currentStreak = 1;
    for (let i = uniqueWeeks.length - 2; i >= 0; i--) {
        if (uniqueWeeks[i] === uniqueWeeks[i + 1] - 1) currentStreak += 1;
        else break;
    }
    return currentStreak;
}

async function recomputeHowManyUsersHaveIt() {
    const grouped = await UserSuccess.aggregate([
        { $group: { _id: "$success", owners: { $sum: 1 } } },
    ]);
    const countBySuccess = new Map(grouped.map(g => [String(g._id), g.owners]));
    const allSuccesses = await Success.find({}, { _id: 1 }).lean();

    const ops = allSuccesses.map(s => ({
        updateOne: {
            filter: { _id: s._id },
            update: { $set: { howManyUsersHaveIt: countBySuccess.get(String(s._id)) || 0 } },
        },
    }));
    if (ops.length > 0) {
        await Success.bulkWrite(ops, { ordered: false });
    }
}

function getEquivalentExpandedSet(variationMap, ids = []) {
    const expanded = new Set();
    for (const id of ids) {
        const key = String(id);
        expanded.add(key);
        const variation = variationMap.get(key);
        if (!variation?.equivalentTo) continue;
        for (const eq of variation.equivalentTo) {
            expanded.add(String(eq));
        }
    }
    return expanded;
}

function timeMs(value) {
    if (value == null) return NaN;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : NaN;
}

/** Date de référence d'une séance : `date`, puis `startedAt`, puis `createdAt` (données legacy). */
function seanceComparableTime(seance) {
    if (!seance) return NaN;
    let t = timeMs(seance.date);
    if (Number.isFinite(t)) return t;
    t = timeMs(seance.startedAt);
    if (Number.isFinite(t)) return t;
    return timeMs(seance.createdAt);
}

/**
 * Séance avec au moins `minSets` séries, chacune marquée PR (même logique que `totalPrCount`).
 * `minSets` vient de `condition.howMany` (défaut 1).
 */
function seanceHasOnlyPrSets(seanceSets, minSets = 1) {
    if (!Array.isArray(seanceSets) || seanceSets.length === 0) return false;
    const min = Number.isFinite(Number(minSets)) && Number(minSets) > 0 ? Number(minSets) : 1;
    if (seanceSets.length < min) return false;
    return seanceSets.every(s => s.PR === "PR");
}

function getSeanceBeforeLimitMs(condition) {
    const raw = condition.datetimeBetweenStart ?? condition.datetimeBetweenEnd;
    if (raw == null || raw === "") return null;
    const ms = timeMs(raw);
    if (!Number.isFinite(ms)) return null;
    return ms;
}

function getQualifiedSeanceIdsByCode(condition, seances, setsBySeance, variationMap) {
    const code = condition?.condition_code;
    const qualified = new Set();
    const howMany = Number(condition?.howMany || 0);

    if (code === "count") {
        for (const seance of seances) qualified.add(String(seance._id));
        return { qualified, count: qualified.size, threshold: howMany };
    }

    if (code === "count_with_duration") {
        const minSecs = condition.durationMinSecs != null ? Number(condition.durationMinSecs) : null;
        const maxSecs = condition.durationMaxSecs != null ? Number(condition.durationMaxSecs) : null;
        for (const seance of seances) {
            if (seance.totalSeconds == null) continue;
            const total = Number(seance.totalSeconds);
            if (!Number.isFinite(total)) continue;
            if (minSecs != null && total < minSecs) continue;
            if (maxSecs != null && total > maxSecs) continue;
            qualified.add(String(seance._id));
        }
        return { qualified, count: qualified.size, threshold: howMany };
    }

    if (code === "count_with_time") {
        for (const seance of seances) {
            const d = new Date(seance.date);
            if (inTimeWindow(d, condition.timeBetweenStart, condition.timeBetweenEnd)) {
                qualified.add(String(seance._id));
            }
        }
        return { qualified, count: qualified.size, threshold: howMany };
    }

    if (code === "count_with_excluded_muscles") {
        const excluded = new Set((condition.excludedMusclesInSeance || "").split("|").map(v => v.trim()).filter(Boolean));
        for (const seance of seances) {
            const sets = setsBySeance.get(String(seance._id)) || [];
            if (!sets.length) continue;
            const usedMuscles = new Set();
            for (const setDoc of sets) {
                const ids = (setDoc.variations || []).map(v => String(v.variation));
                for (const id of ids) {
                    const variation = variationMap.get(id);
                    const primary = variation?.muscles?.primary || [];
                    const secondary = variation?.muscles?.secondary || [];
                    for (const m of [...primary, ...secondary]) usedMuscles.add(m);
                }
            }
            const hasExcluded = [...excluded].some(m => usedMuscles.has(m));
            if (!hasExcluded) qualified.add(String(seance._id));
        }
        return { qualified, count: qualified.size, threshold: howMany };
    }

    if (code === "count_with_type") {
        const variationType = condition.variationType ? String(condition.variationType) : null;
        const minExercises = Number(condition.variationTypeMinExercises || 1);
        if (!variationType) return { qualified, count: 0, threshold: howMany };

        const variationIdsByType = new Set();
        for (const variation of variationMap.values()) {
            if (String(variation.type) === variationType) {
                variationIdsByType.add(String(variation._id));
                for (const eq of variation.equivalentTo || []) variationIdsByType.add(String(eq));
            }
        }

        for (const seance of seances) {
            const sets = setsBySeance.get(String(seance._id)) || [];
            const streetExerciseSignatures = new Set();
            for (const setDoc of sets) {
                const ids = (setDoc.variations || []).map(v => String(v.variation));
                const expanded = getEquivalentExpandedSet(variationMap, ids);
                const isStreet = [...expanded].some(id => variationIdsByType.has(id));
                if (!isStreet) continue;
                const signature = [...new Set(ids)].sort().join("|");
                if (signature) streetExerciseSignatures.add(signature);
            }
            if (streetExerciseSignatures.size >= minExercises) {
                qualified.add(String(seance._id));
            }
        }
        return { qualified, count: qualified.size, threshold: howMany };
    }

    return { qualified, count: 0, threshold: howMany };
}

/**
 * @returns {{ ok: boolean, unlockDetail: object | null }}
 */
function evaluateSuccessWithDetail(condition, context) {
    const {
        userId,
        seances,
        sets,
        setsBySeance,
        variationMap,
        uniqueExerciseCount,
        totalPrCount,
        totalVolume,
        currentWeekStreak,
        imageCount,
    } = context;
    const code = condition?.condition_code;

    if (["count", "count_with_duration", "count_with_excluded_muscles", "count_with_time", "count_with_type"].includes(code)) {
        const { count, threshold } = getQualifiedSeanceIdsByCode(condition, seances, setsBySeance, variationMap);
        const thr = Number(threshold || 0);
        const ok = count >= thr;
        return { ok, unlockDetail: ok ? { totalSeances: count } : null };
    }

    if (code === "sum_volume_total") {
        const thr = Number(condition.howMany || 0);
        const ok = totalVolume >= thr;
        return { ok, unlockDetail: ok ? { totalKg: totalVolume } : null };
    }

    if (code === "unique_variations") {
        const thr = Number(condition.howMany || 0);
        const ok = uniqueExerciseCount >= thr;
        return { ok, unlockDetail: ok ? { totalDistinctExercises: uniqueExerciseCount } : null };
    }

    if (code === "count_prs") {
        const thr = Number(condition.howMany || 0);
        const ok = totalPrCount >= thr;
        return { ok, unlockDetail: ok ? { totalPrs: totalPrCount } : null };
    }

    if (code === "streak_weeks") {
        const thr = Number(condition.howMany || 0);
        const ok = currentWeekStreak >= thr;
        return { ok, unlockDetail: ok ? { bestSerie: currentWeekStreak } : null };
    }

    if (code === "exercise_pr_weight") {
        const familyIds = parseDelimitedIds(condition.variationIds);
        const minLoad = Number(condition.effectiveWeightLoadMin || 0);
        let best = Number.NEGATIVE_INFINITY;
        let bestSet = null;
        for (const setDoc of sets) {
            const ids = (setDoc.variations || []).map(v => String(v.variation));
            const expanded = getEquivalentExpandedSet(variationMap, ids);
            const matches = familyIds.some(id => expanded.has(id));
            if (!matches) continue;
            const effective = getEffectiveLoad(setDoc);
            if (effective > best) {
                best = effective;
                bestSet = setDoc;
            }
        }
        const ok = best >= minLoad;
        return {
            ok,
            unlockDetail: ok && bestSet ? { bestSerie: best, triggeringSet: bestSet } : null,
        };
    }

    if (code === "exercise_pr_reps") {
        const familyIds = parseDelimitedIds(condition.variationIds);
        const minLoad = Number(condition.effectiveWeightLoadMin || 0);
        const minValue = Number(condition.valueMin || 0);
        let best = Number.NEGATIVE_INFINITY;
        let bestSet = null;
        for (const setDoc of sets) {
            const ids = (setDoc.variations || []).map(v => String(v.variation));
            const expanded = getEquivalentExpandedSet(variationMap, ids);
            const matches = familyIds.some(id => expanded.has(id));
            if (!matches) continue;
            const effective = getEffectiveLoad(setDoc);
            if (effective < minLoad) continue;
            const repsEq = getSetRepsEquivalent(setDoc);
            if (repsEq > best) {
                best = repsEq;
                bestSet = setDoc;
            }
        }
        const ok = best >= minValue;
        return {
            ok,
            unlockDetail: ok && bestSet ? { bestSerie: best, triggeringSet: bestSet } : null,
        };
    }

    if (code === "variations_combination") {
        const conditionIds = new Set(parseDelimitedIds(condition.variationIds));
        if (conditionIds.size === 0) return { ok: false, unlockDetail: null };
        for (const setDoc of sets) {
            const ids = (setDoc.variations || []).map(v => String(v.variation));
            const expanded = getEquivalentExpandedSet(variationMap, ids);
            const comboOk = [...conditionIds].every(id => expanded.has(id));
            if (comboOk) return { ok: true, unlockDetail: { triggeringSet: setDoc } };
        }
        return { ok: false, unlockDetail: null };
    }

    if (code === "seance_before_date") {
        const limitMs = getSeanceBeforeLimitMs(condition);
        if (limitMs == null) return { ok: false, unlockDetail: null };

        const timed = seances
            .map(s => ({ s, t: seanceComparableTime(s) }))
            .filter(x => Number.isFinite(x.t));
        if (!timed.length) return { ok: false, unlockDetail: null };

        timed.sort((a, b) => a.t - b.t);
        const earliest = timed[0];
        const ok = timed.some(x => x.t < limitMs);
        if (!ok) return { ok: false, unlockDetail: null };

        return {
            ok: true,
            unlockDetail: { seanceDate: new Date(earliest.t).toISOString() },
        };
    }

    if (code === "seance_specific_day") {
        const md = String(condition.specificDayMonth || "");
        if (!/^\d{2}-\d{2}$/.test(md)) return { ok: false, unlockDetail: null };
        const ordered = [...seances]
            .map(s => ({ s, t: seanceComparableTime(s) }))
            .filter(x => Number.isFinite(x.t))
            .sort((a, b) => a.t - b.t);
        for (const { t } of ordered) {
            const d = new Date(t);
            const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            if (key === md) {
                return { ok: true, unlockDetail: { seanceDate: d.toISOString() } };
            }
        }
        return { ok: false, unlockDetail: null };
    }

    if (code === "user_id") {
        const ok = String(userId) === String(condition.userId || "");
        return { ok, unlockDetail: null };
    }

    if (code === "inactivity") {
        const days = Number(condition.inactivityPeriodDays || 0);
        if (days <= 0) return { ok: false, unlockDetail: null };
        const msGap = days * 24 * 60 * 60 * 1000;
        const ordered = [...seances]
            .map(s => ({ s, t: seanceComparableTime(s) }))
            .filter(x => Number.isFinite(x.t))
            .sort((a, b) => a.t - b.t);
        for (let i = 1; i < ordered.length; i += 1) {
            const gap = ordered[i].t - ordered[i - 1].t;
            if (gap >= msGap) {
                const inactivityDays = Math.floor(gap / (24 * 60 * 60 * 1000));
                return { ok: true, unlockDetail: { inactivityDays } };
            }
        }
        return { ok: false, unlockDetail: null };
    }

    if (code === "n_images") {
        const thr = Number(condition.howMany || 0);
        const ok = imageCount >= thr;
        return { ok, unlockDetail: ok ? { totalImages: imageCount } : null };
    }

    if (code === "specific_totalWeight") {
        const target = Number(condition.howMany || 0);
        const match = seances.find(s => Number(s?.stats?.totalWeight || 0) === target);
        const ok = Boolean(match);
        return {
            ok,
            unlockDetail: ok ? { totalKg: Number(match.stats.totalWeight) } : null,
        };
    }

    if (code === "seance_only_prs") {
        const minSets = Number(condition.howMany || 1);
        const ordered = [...seances]
            .map(s => ({ s, t: seanceComparableTime(s) }))
            .filter(x => Number.isFinite(x.t))
            .sort((a, b) => a.t - b.t);
        for (const { s, t } of ordered) {
            const seanceSets = setsBySeance.get(String(s._id)) || [];
            if (!seanceHasOnlyPrSets(seanceSets, minSets)) continue;
            return {
                ok: true,
                unlockDetail: {
                    seanceId: toObjectId(s._id),
                    setCount: seanceSets.length,
                    minSets,
                    seanceDate: new Date(t).toISOString(),
                },
            };
        }
        return { ok: false, unlockDetail: null };
    }

    return { ok: false, unlockDetail: null };
}

/**
 * Tri pour l’affichage front : niveau du succès décroissant (5 → 0), puis type, puis nom FR.
 */
function sortUserSuccessesBySuccessLevelDesc(items = []) {
    return [...items].sort((a, b) => {
        const la = a.success?.level;
        const lb = b.success?.level;
        const na = Number.isInteger(la) ? la : -1;
        const nb = Number.isInteger(lb) ? lb : -1;
        if (nb !== na) return nb - na;
        const ta = String(a.success?.type || "");
        const tb = String(b.success?.type || "");
        if (ta !== tb) return ta.localeCompare(tb);
        return String(a.success?.name?.fr || "").localeCompare(String(b.success?.name?.fr || ""));
    });
}

async function processNewSuccesses(userId, ttlMinutes = 5) {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) throw new Error("Invalid user ID");

    const cacheKey = String(userObjectId);
    const lastAt = successTtlCache.get(cacheKey);
    const now = Date.now();
    const ttlMs = Number(ttlMinutes) * 60 * 1000;

    const unacknowledgedPromise = UserSuccess.find({ user: userObjectId, acknowledged: false })
        .populate("success")
        .lean();

    if (lastAt && now - lastAt < ttlMs) {
        const list = await unacknowledgedPromise;
        return { userSuccesses: sortUserSuccessesBySuccessLevelDesc(list), recalculated: false };
    }

    const [successes, existingUserSuccesses, seances, sets, allVariations, imageCount] = await Promise.all([
        Success.find({}).lean(),
        UserSuccess.find({ user: userObjectId }).lean(),
        Seance.find({ user: userObjectId })
            .select("_id date totalSeconds stats startedAt createdAt")
            .lean(),
        Seanceset.find({ user: userObjectId })
            .select("_id seance date unit value weightLoad elastic PR variations")
            .lean(),
        Variation.find({}).select("_id type equivalentTo verified popularity createdAt muscles").lean(),
        AwsImage.countDocuments({ user: String(userObjectId) }),
    ]);

    const existingBySuccessId = new Set(existingUserSuccesses.map(us => String(us.success)));
    const unownedSuccesses = successes.filter(s => !existingBySuccessId.has(String(s._id)));

    const variationMap = new Map(allVariations.map(v => [String(v._id), v]));
    const setsBySeance = new Map();
    for (const setDoc of sets) {
        const key = String(setDoc.seance);
        if (!setsBySeance.has(key)) setsBySeance.set(key, []);
        setsBySeance.get(key).push(setDoc);
    }

    const equivalentBySignature = new Map();
    const sortedVerified = allVariations
        .filter(v => v.verified && Array.isArray(v.equivalentTo) && v.equivalentTo.length > 0)
        .sort((a, b) => {
            const p = Number(b.popularity || 0) - Number(a.popularity || 0);
            if (p !== 0) return p;
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        });
    for (const v of sortedVerified) {
        const sig = [...(v.equivalentTo || [])].map(id => String(id)).sort().join("|");
        if (sig && !equivalentBySignature.has(sig)) equivalentBySignature.set(sig, String(v._id));
    }

    const uniqueExerciseSignatures = new Set();
    for (const setDoc of sets) {
        const ids = (setDoc.variations || []).map(v => String(v.variation)).sort();
        if (!ids.length) continue;
        const sig = ids.join("|");
        uniqueExerciseSignatures.add(equivalentBySignature.get(sig) || sig);
    }

    const context = {
        userId: String(userObjectId),
        seances,
        sets,
        setsBySeance,
        variationMap,
        uniqueExerciseCount: uniqueExerciseSignatures.size,
        totalPrCount: sets.filter(s => s.PR === "PR").length,
        totalVolume: seances.reduce((acc, s) => acc + Number(s?.stats?.totalWeight || 0), 0),
        currentWeekStreak: computeCurrentWeekStreak(seances),
        imageCount,
    };

    const toCreate = [];
    for (const success of unownedSuccesses) {
        const { ok, unlockDetail } = evaluateSuccessWithDetail(success.condition || {}, context);
        if (ok) {
            const doc = {
                user: userObjectId,
                success: success._id,
                acknowledged: false,
                usedOnProfile: false,
            };
            if (unlockDetail && Object.keys(unlockDetail).length > 0) {
                doc.unlockDetail = unlockDetail;
            }
            toCreate.push(doc);
        }
    }

    if (toCreate.length > 0) {
        await UserSuccess.insertMany(toCreate, { ordered: false });
    }

    await recomputeHowManyUsersHaveIt();
    successTtlCache.set(cacheKey, now);

    const unackList = await UserSuccess.find({ user: userObjectId, acknowledged: false })
        .populate("success")
        .lean();
    return {
        userSuccesses: sortUserSuccessesBySuccessLevelDesc(unackList),
        recalculated: true,
    };
}

async function acknowledgeUserSuccesses(userId, userSuccessIds = []) {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) throw new Error("Invalid user ID");
    const ids = userSuccessIds.map(toObjectId).filter(Boolean);
    if (!ids.length) throw new Error("userSuccessIds is required");

    await UserSuccess.updateMany(
        { _id: { $in: ids }, user: userObjectId },
        { $set: { acknowledged: true } }
    );
}

async function setProfileUse(userId, successIds = []) {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) throw new Error("Invalid user ID");
    const ids = successIds.map(toObjectId).filter(Boolean);
    const uniqueIds = [...new Map(ids.map(id => [String(id), id])).values()];
    if (uniqueIds.length < 1 || uniqueIds.length > 3) {
        throw new Error("You must select between 1 and 3 successes");
    }

    const ownedCount = await UserSuccess.countDocuments({
        user: userObjectId,
        success: { $in: uniqueIds },
    });
    if (ownedCount !== uniqueIds.length) {
        throw new Error("Some selected successes are not owned by this user");
    }

    await UserSuccess.updateMany({ user: userObjectId }, { $set: { usedOnProfile: false } });
    await UserSuccess.updateMany(
        { user: userObjectId, success: { $in: uniqueIds } },
        { $set: { usedOnProfile: true } }
    );
}

const SUCCESS_ALL_MAX_LIMIT = 200;

/**
 * Catalogue des succès enrichi pour un user.
 * Sans `limit` : retourne tout (comportement historique).
 * Avec `limit` : pagination 1-based (`page`, `limit` borné à SUCCESS_ALL_MAX_LIMIT).
 */
async function getAllSuccessesForUser(userId, options = {}) {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) throw new Error("Invalid user ID");

    const pageRaw = Number(options.page);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
    const limitRaw = options.limit;
    const limitNum = limitRaw === undefined || limitRaw === null || limitRaw === "" ? null : Number(limitRaw);
    const usePagination =
        limitNum !== null && Number.isFinite(limitNum) && limitNum > 0;
    const limit = usePagination ? Math.min(Math.max(1, Math.floor(limitNum)), SUCCESS_ALL_MAX_LIMIT) : null;

    const seanceUsers = Seance.distinct("user");
    const ownedPromise = UserSuccess.find({ user: userObjectId }).lean();
    const totalPromise = Success.countDocuments({});

    let successesQuery = Success.find({}).sort({ level: -1, type: 1 }).lean();
    if (limit !== null) {
        successesQuery = Success.find({})
            .sort({ level: -1, type: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();
    }

    const [successes, totalCount, owned, activeUsers] = await Promise.all([
        successesQuery,
        totalPromise,
        ownedPromise,
        User.countDocuments({ _id: { $in: await seanceUsers } }),
    ]);

    const ownedMap = new Map(owned.map(o => [String(o.success), o]));
    const successesMapped = successes.map(success => {
        const us = ownedMap.get(String(success._id));
        const owners = Number(success.howManyUsersHaveIt || 0);
        const totalActive = Number(activeUsers || 0);
        return {
            ...success,
            isOwned: Boolean(us),
            acknowledged: Boolean(us?.acknowledged),
            usedOnProfile: Boolean(us?.usedOnProfile),
            unlockDetail: us?.unlockDetail ?? null,
            usersTotalForProportion: totalActive,
            usersWithSuccessProportion: totalActive > 0 ? owners / totalActive : 0,
        };
    });

    if (limit === null) {
        return { successes: successesMapped, total: totalCount };
    }

    return {
        successes: successesMapped,
        total: totalCount,
        page,
        limit,
        hasMore: page * limit < totalCount,
    };
}

/**
 * Succès affichés sur le profil (1 à 3), même enrichissement que getAllSuccessesForUser.
 */
async function getUsedOnProfileSuccessesForUser(userId) {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) throw new Error("Invalid user ID");

    const seanceUsers = Seance.distinct("user");
    const [list, activeUsers] = await Promise.all([
        UserSuccess.find({ user: userObjectId, usedOnProfile: true })
            .populate("success")
            .lean(),
        User.countDocuments({ _id: { $in: await seanceUsers } }),
    ]);

    const totalActive = Number(activeUsers || 0);
    const successesMapped = list
        .map(us => {
            const s = us.success;
            if (!s) return null;
            const owners = Number(s.howManyUsersHaveIt || 0);
            return {
                ...s,
                isOwned: true,
                acknowledged: Boolean(us?.acknowledged),
                usedOnProfile: true,
                unlockDetail: us?.unlockDetail ?? null,
                usersTotalForProportion: totalActive,
                usersWithSuccessProportion: totalActive > 0 ? owners / totalActive : 0,
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            const t = (a.type || 0) - (b.type || 0);
            if (t !== 0) return t;
            return (a.level || 0) - (b.level || 0);
        });

    return { successes: successesMapped };
}

module.exports = {
    processNewSuccesses,
    acknowledgeUserSuccesses,
    setProfileUse,
    getAllSuccessesForUser,
    getUsedOnProfileSuccessesForUser,
};
