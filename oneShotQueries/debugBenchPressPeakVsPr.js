/**
 * Diagnostic: pourquoi aucun PR n'a Δ=0% vs le pic de force ?
 *
 * Usage: node oneShotQueries/debugBenchPressPeakVsPr.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const setLib = require('../lib/set');

const USER_ID = '6365489f44d4b4000470882b';
const VAR_BARRE_GUIDEE = '6922144c1c858345acc2d0ce';

function relDiff(entryRef, peakRef) {
    if (!Number.isFinite(entryRef) || !Number.isFinite(peakRef) || peakRef <= 0) return null;
    return Math.abs(peakRef - entryRef) / peakRef;
}

function fmtPct(ratio) {
    if (ratio == null) return 'n/a';
    return `${Math.round(ratio * 1000) / 10}%`;
}

function summarizeSet(s) {
    if (!s) return null;
    return {
        id: s._id != null ? String(s._id) : s.setId != null ? String(s.setId) : null,
        date: s.date ? new Date(s.date).toISOString().slice(0, 10) : null,
        value: s.value ?? s.rawValue,
        unit: s.unit,
        weightLoad: s.weightLoad ?? s.rawWeightLoad,
        normalizedOneRm: s.normalizedOneRm ?? null,
        brzycki: s.brzycki ?? s.normalizedBrzycki ?? null,
        epley: s.epley ?? s.normalizedEpley ?? null,
        rpe: s.rpe ?? null,
    };
}

async function main() {
    const mongoUrl = process.env.MONGO_URL || process.env.mongoURL;
    const database = process.env.DATABASE;
    if (!mongoUrl || !database) {
        throw new Error('Missing MONGO_URL/mongoURL or DATABASE in environment variables.');
    }
    await mongoose.connect(mongoUrl + database, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    console.log('Connected.\n');

    const mainExerciseId = VAR_BARRE_GUIDEE;
    const referenceVariations = [VAR_BARRE_GUIDEE];

    const [timeseries, figurePrs, figureDetailedPrs] = await Promise.all([
        setLib.getNormalizedProgressionTimeseries({
            userId: USER_ID,
            referenceVariations,
            mainExerciseId,
            dateMin: null,
            lateralMode: 'bilateral',
            weightUnit: 'kg',
        }),
        setLib.getFigurePRs({
            userId: USER_ID,
            referenceVariations,
            mainExerciseId,
            dateMin: null,
            lateralMode: 'bilateral',
            includeAllGraphTargets: true,
            maxTargets: 40,
        }),
        setLib.getFigureDetailedPRs({
            userId: USER_ID,
            referenceVariations,
            mainExerciseId,
            dateMin: null,
            lateralMode: 'bilateral',
            includeAllGraphTargets: true,
            maxTargets: 40,
        }),
    ]);

    const peakRef = Number(timeseries?.meta?.strengthPeak?.referenceKg);
    const peakSource = timeseries?.meta?.strengthPeak?.source;
    console.log('=== PIC DE FORCE (timeseries meta) ===');
    console.log('referenceKg:', peakRef);
    console.log('scope:', timeseries?.meta?.strengthPeak?.sourceScope);
    console.log('source set:', summarizeSet(peakSource));
    console.log('points count:', timeseries?.points?.length ?? 0);

    const points = Array.isArray(timeseries?.points) ? timeseries.points : [];
    const topPoints = [...points]
        .map((p) => ({
            ...summarizeSet(p),
            delta: relDiff(Number(p.normalizedOneRm ?? p.brzycki), peakRef),
        }))
        .filter((p) => Number.isFinite(Number(p.normalizedOneRm ?? p.brzycki)))
        .sort((a, b) => Number(b.normalizedOneRm ?? b.brzycki) - Number(a.normalizedOneRm ?? a.brzycki))
        .slice(0, 8);
    console.log('\n=== TOP 8 POINTS TIMESERIES (normalizedOneRm) ===');
    topPoints.forEach((p, i) => {
        console.log(`${i + 1}. Δ=${fmtPct(p.delta)} | 1RM=${p.normalizedOneRm ?? p.brzycki} | ${p.value} ${p.unit} @ ${p.weightLoad} kg | ${p.date}`);
    });

    const zeroRepSets = points.filter((p) => !Number.isFinite(Number(p.rawValue)) || Number(p.rawValue) <= 0);
    console.log('\n=== SETS value<=0 dans timeseries (devrait être 0 avec valueMin=0) ===', zeroRepSets.length);

    console.log('\n=== CIBLES PR (allowlist) ===');
    for (const entry of figurePrs?.entries || []) {
        const name = typeof entry.name === 'object' ? (entry.name?.fr || entry.name?.en) : entry.name;
        console.log(`- ${name} (${entry.variationId}) direct=${entry.isDirect} edge=${entry.isEdgeTarget}`);
    }

    console.log('\n=== strengthPeaksBySignature (timeseries meta) ===');
    const peaksBySig = timeseries?.meta?.strengthPeaksBySignature || {};
    for (const [sig, peak] of Object.entries(peaksBySig)) {
        console.log(`  ${sig}: referenceKg=${peak?.referenceKg}`);
    }

    console.log('\n=== DELTA PAR ENTRÉE PR (catégories, pic propre à l\'entrée) ===');
    for (const entry of figurePrs?.entries || []) {
        const name = typeof entry.name === 'object' ? (entry.name?.fr || entry.name?.en) : entry.name;
        const entryPeakRef = Number(entry?.strengthPeak?.referenceKg);
        console.log(`\n--- ${name} (entry peak=${entryPeakRef}) ---`);
        let minDelta = Infinity;
        for (const [cat, slots] of Object.entries(entry.prs || {})) {
            for (const unit of ['repetitions', 'seconds']) {
                const pr = slots?.[unit];
                if (!pr) continue;
                const delta = Number.isFinite(pr.peakForceDiff)
                    ? pr.peakForceDiff
                    : relDiff(Number(pr.normalizedOneRm), entryPeakRef);
                if (delta != null && delta < minDelta) minDelta = delta;
                console.log(`  ${cat}/${unit}: ${pr.value} @ ${pr.weightLoad}kg | Δ=${fmtPct(delta)} (backend=${fmtPct(pr.peakForceDiff)})`);
            }
        }
        console.log(`  => min Δ=${fmtPct(minDelta === Infinity ? null : minDelta)}`);
    }

    console.log('\n=== DELTA LEGACY vs pic global (référence) ===');
    for (const entry of figurePrs?.entries || []) {
        const name = typeof entry.name === 'object' ? (entry.name?.fr || entry.name?.en) : entry.name;
        console.log(`\n--- ${name} ---`);
        for (const [cat, slots] of Object.entries(entry.prs || {})) {
            for (const unit of ['repetitions', 'seconds']) {
                const pr = slots?.[unit];
                if (!pr) continue;
                const entryRef = Number(pr.normalizedOneRm);
                const delta = relDiff(entryRef, peakRef);
                console.log(`  ${cat}/${unit}: ${pr.value} @ ${pr.weightLoad}kg | norm1RM=${entryRef} | Δ=${fmtPct(delta)} | ${pr.date ? new Date(pr.date).toISOString().slice(0, 10) : '?'}`);
            }
        }
    }

    console.log('\n=== DELTA PAR ENTRÉE PR (nRM détaillés, reps only) ===');
    for (const entry of figureDetailedPrs?.entries || []) {
        const name = typeof entry.name === 'object' ? (entry.name?.fr || entry.name?.en) : entry.name;
        let minDelta = Infinity;
        let minRow = null;
        for (const [key, slots] of Object.entries(entry.prs || {})) {
            const pr = slots?.repetitions;
            if (!pr) continue;
            const entryRef = Number(pr.normalizedOneRm);
            const delta = relDiff(entryRef, peakRef);
            if (delta != null && delta < minDelta) {
                minDelta = delta;
                minRow = { key, pr, entryRef, delta };
            }
        }
        console.log(`\n--- ${name} --- min Δ=${fmtPct(minDelta === Infinity ? null : minDelta)} (${minRow?.key}: ${minRow?.pr?.value} @ ${minRow?.pr?.weightLoad}kg, norm1RM=${minRow?.entryRef})`);
    }

    // Vérifier sets bruts value=0 en base pour cette variation
    const Set = require('../schema/seanceset');
    const zeroInDb = await Set.find({
        user: new mongoose.Types.ObjectId(USER_ID),
        'variations.variation': new mongoose.Types.ObjectId(VAR_BARRE_GUIDEE),
        value: { $lte: 0 },
    }, { value: 1, unit: 1, date: 1, weightLoad: 1 }).limit(10).lean();
    console.log('\n=== SETS BRUTS value<=0 EN BASE (barre guidée) ===', zeroInDb.length);
    zeroInDb.forEach((s) => console.log(' ', summarizeSet(s)));

    // Le pic est-il un set qui n'est PR à aucun nRM ?
    const peakSetId = peakSource?.setId != null ? String(peakSource.setId) : null;
    if (peakSetId) {
        let foundInPr = false;
        for (const entry of figureDetailedPrs?.entries || []) {
            for (const slots of Object.values(entry.prs || {})) {
                const pr = slots?.repetitions;
                if (pr && String(pr._id) === peakSetId) {
                    foundInPr = true;
                    console.log(`\n=== SET PIC trouvé dans PR détaillé (${entry.name?.fr || entry.variationId}) ===`);
                }
            }
        }
        if (!foundInPr) {
            console.log('\n=== SET PIC *** NON PRÉSENT *** dans aucune ligne nRM détaillée ===');
            console.log('(normal si le pic vient d\'un set multi-reps dont le PR nRM est un autre set)');
        }
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
