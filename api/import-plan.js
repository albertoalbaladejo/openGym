/* Turn an import payload (docs/IMPORT_API.md) into openGym's own state shape.
 *
 * Nothing here invents a parallel structure: routines, `week`, `dayPlan` and `customEx` are
 * written exactly as frontend/src/lib reads them, the rep range goes through the app's own
 * normalizeRepRange, and the progression policies are the app's own POLICIES. What the
 * payload adds on top — phases, plan weeks, deload weeks — has no counterpart in openGym
 * (see SCHEMA_NOTES.md §8) and is flattened here rather than stored.
 *
 * Pure: takes a state object and a payload, mutates the state, returns a summary. The HTTP
 * layer in server.js does the auth, the backup and the write.
 */
import { normalizeRepRange } from '../frontend/src/lib/rep-range.js';
import { resolveExercise, cleanName } from './exercise-resolve.js';

/* ---------- progression ---------- */

// openGym's own names, plus the ones a plan is likely to be written with.
const PROG_ALIASES = {
  off: 'off', none: 'off', ninguna: 'off',
  linear: 'linear', linear_progression: 'linear', lineal: 'linear', progresion_lineal: 'linear',
  greyskull: 'greyskull', greyskull_lp: 'greyskull', greyskull_linear_progression: 'greyskull',
  double: 'double', double_progression: 'double', doble: 'double', doble_progresion: 'double',
  time: 'time', tiempo: 'time', add_time: 'time',
};
export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time'];

/** A payload progression name → an openGym policy, or null when it is not one. */
export function normalizeProgression(v) {
  if (v == null || v === '') return null;
  const k = String(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[\s-]+/g, '_');
  return PROG_ALIASES[k] || null;
}

/* ---------- numbers written as text ---------- */

/** "12" → {reps:12}. "8-10" → {repsMin:8, reps:10}. Also accepts a plain number. */
export function parseReps(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const range = /^(\d+)\s*[-–—a]\s*(\d+)$/.exec(s);
  if (range) {
    const lo = +range[1], hi = +range[2];
    return lo <= hi ? { repsMin: lo, reps: hi } : { repsMin: hi, reps: lo };
  }
  const one = /^(\d+)/.exec(s);
  return one ? { reps: +one[1] } : null;
}

/** "30-45" → 30 (the bottom of a prescribed hold is the target; `time` progression raises it). */
export function parseSeconds(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const range = /^(\d+)\s*[-–—a]\s*(\d+)$/.exec(s);
  if (range) return Math.min(+range[1], +range[2]);
  const one = /^(\d+(?:[.,]\d+)?)/.exec(s);
  return one ? Math.round(parseFloat(one[1].replace(',', '.'))) : null;
}

/**
 * "20-30" → { weight: 20, text: '20-30' }; "10-15 por lado" → { weight: 10, text: '10-15 por lado' }.
 * `weight` is a single number in openGym, so a prescribed range keeps its bottom end and the
 * text it was written as travels to the exercise note — a range is a decision to make at the
 * rack, and dropping it silently loses half the prescription.
 */
export function parseWeight(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? { weight: v, text: null } : null;
  const s = String(v).trim();
  const m = /(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return null;
  const weight = parseFloat(m[1].replace(',', '.'));
  const extra = /[-–—]\s*\d|por\s+lado|per\s+side|cada\s+lado/i.test(s) ? s : null;
  return { weight, text: extra };
}

/* ---------- weekdays ---------- */

// getDay(): 0 = Sunday … 6 = Saturday. Same indexing S.week uses.
const WEEKDAY_NAMES = {
  domingo: 0, sunday: 0, sun: 0, dom: 0,
  lunes: 1, monday: 1, mon: 1, lun: 1,
  martes: 2, tuesday: 2, tue: 2, mar: 2,
  miercoles: 3, wednesday: 3, wed: 3, mie: 3,
  jueves: 4, thursday: 4, thu: 4, jue: 4,
  viernes: 5, friday: 5, fri: 5, vie: 5,
  sabado: 6, saturday: 6, sat: 6, sab: 6,
};

/** "Miércoles" → 3, "Sábado (opcional)" → 6, "variable" → null. */
export function parseWeekday(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 6 ? v : null;
  const k = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)[0];
  return k in WEEKDAY_NAMES ? WEEKDAY_NAMES[k] : null;
}

/* ---------- misc ---------- */

const PER_SIDE_RE = /\bpor\s+(lado|pierna|brazo)\b|\bper\s+side\b|\bcada\s+(lado|pierna|brazo)\b/i;
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const GLYPH_BY_NAME = [
  [/\b(pierna|piernas|legs|leg)\b/i, 'legs'],
  [/\b(pull|tiron|espalda|back)\b/i, 'pullup'],
  [/\b(push|empuje|torso|pecho|chest)\b/i, 'barbell'],
  [/\b(full\s*body|cuerpo\s*completo)\b/i, 'figureStrength'],
  [/\b(cardio|hiit|caminata|bici|carrera)\b/i, 'figureRun'],
  [/\b(postural|movilidad|estiramiento|mobility)\b/i, 'stretch'],
];
const glyphFor = name => (GLYPH_BY_NAME.find(([re]) => re.test(name)) || [])[1] || 'figureStrength';

/** Join note fragments without repeating one or leaving a stray separator. */
const joinNotes = (...parts) => {
  const seen = [];
  for (const p of parts) {
    const s = String(p == null ? '' : p).trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.length ? seen.join(' · ') : undefined;
};

/* ---------- one exercise ---------- */

/**
 * Build one entry of a routine's `ex[]` from one payload exercise.
 * Returns { cfg, resolution, warnings } — cfg is null only when the name could not resolve
 * to anything at all (an empty name, or a stated exercise_id that does not exist).
 */
export function buildExercise(src, ctx) {
  const warnings = [];
  const resolution = resolveExercise(src, ctx);
  if (!resolution.id) return { cfg: null, resolution, warnings };

  const cfg = { id: resolution.id, sets: Math.max(1, Math.round(+src.sets || 1)) };

  const secs = parseSeconds(src.timed_s ?? src.seconds ?? src.sec);
  const cardioMin = src.duration_min ?? src.min;
  const isCardio = src.mode === 'cardio' || (cardioMin != null && src.reps == null && secs == null);

  if (isCardio) {
    // 'cardio' is written explicitly for the same reason 'time' is: without it, modeOf() reads
    // the mode off the catalogue entry, and an invented cardio exercise is not in the catalogue.
    cfg.mode = 'cardio';
    const min = parseSeconds(cardioMin);
    if (min != null) cfg.min = min;
    if (src.speed != null && isFinite(+src.speed)) cfg.speed = +src.speed;
  } else if (secs != null) {
    // A timed hold MUST carry mode:'time' — without it 45 seconds is logged as 45 reps.
    cfg.mode = 'time';
    cfg.sec = secs;
  } else {
    const reps = parseReps(src.reps);
    if (!reps) {
      warnings.push(`"${resolution.name}": no reps, no hold and no duration — defaulted to 10 reps`);
      cfg.reps = 10;
    } else {
      cfg.reps = reps.reps;
      if (reps.repsMin != null) cfg.repsMin = reps.repsMin;
    }
  }

  const w = parseWeight(src.starting_weight_kg ?? src.weight);
  const weightNote = w?.text || null;
  if (w && w.weight > 0) cfg.weight = w.weight;

  const rest = parseSeconds(src.rest_s ?? src.restSec);
  if (rest != null && rest > 0) cfg.restSec = rest;

  // `side` counts REPS per side, so it is meaningless on a hold or a cardio block — a
  // "30-40s por lado" plank keeps the instruction in its note instead (SCHEMA_NOTES §8.7).
  const perSideAsked = src.per_side === true || src.side === true || PER_SIDE_RE.test(String(src.note || ''));
  if (perSideAsked) {
    if (cfg.mode === undefined) cfg.side = true;
    else warnings.push(`"${resolution.name}": "per side" only applies to rep work — kept as a note`);
  }

  if (src.bodyweight != null) cfg.bodyweight = !!src.bodyweight;

  const prog = normalizeProgression(src.progression ?? src.prog);
  if (src.progression != null && !prog) warnings.push(`"${resolution.name}": unknown progression "${src.progression}" — falling back to the routine default`);
  if (prog) cfg.prog = prog;
  if (src.increment_kg != null && isFinite(+src.increment_kg) && +src.increment_kg > 0) cfg.inc = +src.increment_kg;
  if (src.warmup_sets != null && +src.warmup_sets > 0) cfg.warmupSets = Math.round(+src.warmup_sets);

  // openGym has no tag system on an exercise (SCHEMA_NOTES §8.4). `note` is the only free
  // field, and `sg` must not be borrowed for it — it drives superset grouping.
  const note = joinNotes(src.tag ? String(src.tag) : null, src.note, weightNote);
  if (note) cfg.note = note;

  return { cfg, resolution, warnings };
}

/* ---------- one routine ---------- */

/** Build a routine's `ex[]`, wire up supersets, and collect what happened. */
function buildExerciseList(list, ctx, summary) {
  const out = [];
  const byName = new Map();     // cleaned name → index in `out`, for superset_with
  (list || []).forEach(src => {
    const { cfg, resolution, warnings } = buildExercise(src, ctx);
    warnings.forEach(w => summary.warnings.push(w));
    if (!cfg) {
      summary.exercises.unresolved.push({ name: resolution.name, reason: resolution.reason });
      return;
    }
    if (resolution.via === 'custom-new') summary.exercises.custom_created.push({ name: resolution.name, id: resolution.id, body_part: resolution.created.bp });
    else if (resolution.via === 'custom-existing') summary.exercises.custom_reused.push({ name: resolution.name, id: resolution.id });
    else summary.exercises.matched.push({ name: resolution.name, id: resolution.id, via: resolution.via });
    byName.set(cleanName(src.name).toLowerCase(), out.length);
    out.push({ cfg, src });
  });

  // Supersets: openGym groups by a shared `sg`, and history.js drops an `sg` whose neighbour
  // does not share it — so the members have to be adjacent. A pair that is not adjacent is
  // reported rather than written as a group that the app would silently ungroup on first read.
  let sgN = 0;
  out.forEach((row, i) => {
    const partner = row.src.superset_with;
    if (!partner) return;
    const j = byName.get(cleanName(partner).toLowerCase());
    if (j == null) { summary.warnings.push(`superset target "${partner}" is not in the same day — no group created`); return; }
    if (Math.abs(i - j) !== 1) { summary.warnings.push(`"${row.src.name}" and "${partner}" are not adjacent — openGym only groups neighbouring exercises, no group created`); return; }
    const sg = out[i].cfg.sg || out[j].cfg.sg || `sg${++sgN}`;
    out[i].cfg.sg = sg;
    out[j].cfg.sg = sg;
  });

  return out.map(r => r.cfg);
}

/** Reduce a routine's volume for a deload: fewer sets, same weight. */
function deloadOf(routine, reduction, suffix) {
  const cut = Math.max(0, Math.min(0.95, +reduction || 0));
  return {
    ...routine,
    name: `${routine.name}${suffix}`,
    excludeFromProgression: true,
    ex: routine.ex.map(e => ({ ...e, sets: Math.max(1, Math.round(e.sets * (1 - cut))) })),
  };
}

/* ---------- the import ---------- */

/**
 * Apply a payload to a state object, in place.
 *
 * @param {object} state   the profile's state (the defaults shape; see SCHEMA_NOTES §3)
 * @param {object} payload the import payload (docs/IMPORT_API.md)
 * @param {object} opts    { uid } — id minter, injected so tests are deterministic
 * @returns {object} the summary the endpoint answers with
 */
export function importPlan(state, payload, { uid }) {
  const summary = {
    plan: payload?.plan || null,
    routines: { created: [], updated: [] },
    exercises: { matched: [], custom_created: [], custom_reused: [], unresolved: [] },
    week: {},
    day_overrides: 0,
    warnings: [],
  };

  state.routines = Array.isArray(state.routines) ? state.routines : [];
  state.customEx = Array.isArray(state.customEx) ? state.customEx : [];
  state.week = state.week && typeof state.week === 'object' ? state.week : {};
  state.dayPlan = state.dayPlan && typeof state.dayPlan === 'object' ? state.dayPlan : {};

  const ctx = { customEx: state.customEx, newCustom: [], uid };
  const phases = Array.isArray(payload?.phases) ? payload.phases : [];
  if (!phases.length && !Array.isArray(payload?.daily_postural_routine)) {
    throw Object.assign(new Error('payload has no phases and no daily_postural_routine'), { status: 400 });
  }

  const emitDeload = payload.emit_deload_routines !== false;
  const deloadSuffix = payload.deload_suffix || ' (descarga)';
  const startDate = payload.start_date ? new Date(payload.start_date + 'T12:00:00') : null;
  if (payload.start_date && isNaN(+startDate)) {
    throw Object.assign(new Error(`start_date "${payload.start_date}" is not an ISO date (YYYY-MM-DD)`), { status: 400 });
  }

  // Which phase drives S.week. Only one can: a weekday holds exactly one routine
  // (SCHEMA_NOTES §3), so the other phases are created but left unscheduled.
  const activeIdx = pickActivePhase(phases, payload.active_phase, summary);

  /* --- the daily postural block, built once and reused --- */
  const posturalSrc = Array.isArray(payload.daily_postural_routine) ? payload.daily_postural_routine : [];
  const appendPostural = payload.append_postural_to_training_days !== false;
  const posturalEx = posturalSrc.length ? buildExerciseList(posturalSrc, ctx, summary) : [];
  const posturalTagged = posturalEx.map(e => ({ ...e, note: joinNotes('postural', e.note) }));

  /* --- routines, phase by phase --- */
  const built = [];      // { routine, weekdays, phaseIdx, deloadWeeks, deloadOf? }
  phases.forEach((phase, pi) => {
    const phaseName = String(phase?.name || `Fase ${pi + 1}`).trim();
    const phaseProg = normalizeProgression(phase?.progression_default);
    if (phase?.progression_default != null && !phaseProg) {
      summary.warnings.push(`phase "${phaseName}": unknown progression_default "${phase.progression_default}" — routines left on the app default`);
    }
    const deloadWeeks = (Array.isArray(phase?.deload_weeks) ? phase.deload_weeks : []).map(Number).filter(Number.isFinite);
    const reduction = phase?.deload_volume_reduction;

    const days = [...(Array.isArray(phase?.days) ? phase.days : []),
      ...(Array.isArray(phase?.cardio) ? phase.cardio.map(cardioAsDay) : [])];

    days.forEach((day, di) => {
      const dayName = String(day?.name || `Día ${di + 1}`).trim();
      const routineName = `${prefixOf(phaseName, pi)} · ${dayName}`;
      const ex = buildExerciseList(day?.exercises, ctx, summary);
      if (appendPostural && posturalTagged.length && day?.append_postural !== false && !day?.is_cardio) {
        ex.push(...posturalTagged.map(e => ({ ...e })));
      }
      const routine = { name: routineName, emoji: glyphFor(dayName), ex };
      const prog = normalizeProgression(day?.progression) || phaseProg;
      if (prog) routine.prog = prog;
      applyDoubleProgressionRanges(routine, summary);

      const weekdays = [];
      (day?.repeat_days || day?.days || []).forEach(d => {
        const wd = parseWeekday(d);
        if (wd == null) summary.warnings.push(`"${routineName}": "${d}" is not a weekday — not scheduled`);
        else if (!weekdays.includes(wd)) weekdays.push(wd);
      });

      built.push({ routine, weekdays, phaseIdx: pi, deloadWeeks, reduction, deloadSuffix, emitDeload });
    });
  });

  /* --- a standalone postural routine for the days that would be rest --- */
  const posturalRoutineName = payload.postural_routine_name || 'Postural diario';
  const wantsPosturalRoutine = posturalTagged.length > 0 && payload.schedule_postural_on_rest_days !== false;
  let posturalRoutine = null;
  if (wantsPosturalRoutine) {
    posturalRoutine = { name: posturalRoutineName, emoji: 'stretch', prog: 'off', ex: posturalTagged.map(e => ({ ...e })) };
  }

  /* --- write everything, idempotently --- */
  const upsert = r => {
    const existing = state.routines.find(x => (x.name || '').trim().toLowerCase() === r.name.trim().toLowerCase());
    if (existing) {
      // Keep the id: the week schedule, day overrides and any workout already logged against
      // this routine all point at it. Replacing it would orphan them.
      Object.assign(existing, r, { id: existing.id });
      if (!r.prog) delete existing.prog;
      if (!r.excludeFromProgression) delete existing.excludeFromProgression;
      summary.routines.updated.push(existing.name);
      return existing;
    }
    const fresh = { id: uid(), ...r };
    state.routines.push(fresh);
    summary.routines.created.push(fresh.name);
    return fresh;
  };

  built.forEach(b => {
    b.saved = upsert(b.routine);
    if (b.emitDeload && b.deloadWeeks.length) {
      b.savedDeload = upsert(deloadOf(b.routine, b.reduction, b.deloadSuffix));
    }
  });
  if (posturalRoutine) posturalRoutine = upsert(posturalRoutine);

  // Merge the customs this import invented into the profile's own list.
  ctx.newCustom.forEach(c => { if (!state.customEx.some(x => x.id === c.id)) state.customEx.push(c); });

  /* --- the weekly schedule, from the active phase only --- */
  if (activeIdx >= 0) {
    const taken = new Set();
    built.filter(b => b.phaseIdx === activeIdx).forEach(b => {
      b.weekdays.forEach(wd => {
        if (taken.has(wd)) { summary.warnings.push(`weekday ${wd} is claimed by more than one day of the active phase — "${b.saved.name}" kept the last word`); }
        taken.add(wd);
        state.week[wd] = b.saved.id;
        summary.week[wd] = b.saved.name;
      });
    });
    if (posturalRoutine) {
      for (let wd = 0; wd <= 6; wd++) {
        if (!taken.has(wd)) { state.week[wd] = posturalRoutine.id; summary.week[wd] = posturalRoutine.name; }
      }
    }
  }

  /* --- deload weeks land on the calendar only when the plan says when it starts --- */
  if (startDate && emitDeload) {
    built.forEach(b => {
      if (!b.savedDeload) return;
      b.deloadWeeks.forEach(week => {
        b.weekdays.forEach(wd => {
          const d = new Date(startDate);
          d.setDate(d.getDate() + (week - 1) * 7 + ((wd + 6) % 7));
          state.dayPlan[isoOf(d)] = b.savedDeload.id;
          summary.day_overrides++;
        });
      });
    });
  } else if (emitDeload && built.some(b => b.savedDeload)) {
    summary.warnings.push('deload routines were created but not scheduled — add "start_date" (the Monday of plan week 1) to have them written into dayPlan');
  }

  state._ts = Date.now();
  return summary;
}


/* Double progression needs two bounds. A plan that prescribes a flat "4 × 10" under a double
 * default is not wrong — the app fills the missing floor in with normalizeRepRange the moment
 * it reads the config — but the range is then invisible in the editor and in the shared plan
 * file. Writing both bounds explicitly, through the app's own normalizer, makes the
 * prescription say what the app is going to do with it.
 */
function applyDoubleProgressionRanges(routine, summary) {
  const filled = [];
  routine.ex.forEach(e => {
    const policy = e.prog || routine.prog;
    if (policy !== 'double') return;
    if (e.mode === 'time' || e.mode === 'cardio') return;
    if (e.repsMin != null) return;
    const { reps, repsMin } = normalizeRepRange(e.reps, e.repsMin);
    e.reps = reps;
    e.repsMin = repsMin;
    filled.push(`${repsMin}-${reps}`);
  });
  if (filled.length) {
    summary.warnings.push(`"${routine.name}": ${filled.length} exercise(s) had a single rep target under double progression — filled the range in as ${[...new Set(filled)].join(', ')} (openGym's own normalizeRepRange)`);
  }
}

/* A cardio block from the payload, shaped like a day so it goes through the same path. */
function cardioAsDay(c, i) {
  return {
    name: c.name || `Cardio ${i + 1}`,
    repeat_days: c.days || [],
    is_cardio: true,
    exercises: [{
      name: c.type || 'cardio',
      sets: c.sets || 1,
      duration_min: c.duration_min,
      speed: c.speed,
      mode: 'cardio',
      progression: 'off',
      note: [c.intensity, c.frequency, c.pattern].filter(Boolean).join(' · ') || undefined,
    }],
  };
}

/** "Fase 1 — Base" → "F1". Short enough that the routine name still reads on a phone. */
function prefixOf(phaseName, i) {
  const m = /\b(?:fase|phase|bloque|block)\s*(\d+)/i.exec(phaseName);
  return m ? `F${m[1]}` : `F${i + 1}`;
}

function pickActivePhase(phases, asked, summary) {
  if (!phases.length) return -1;
  if (asked == null) return 0;
  if (typeof asked === 'number') {
    if (asked >= 0 && asked < phases.length) return asked;
    summary.warnings.push(`active_phase ${asked} is out of range — scheduled the first phase instead`);
    return 0;
  }
  const want = String(asked).toLowerCase().trim();
  const idx = phases.findIndex(p => String(p?.name || '').toLowerCase().trim() === want);
  if (idx >= 0) return idx;
  summary.warnings.push(`active_phase "${asked}" matches no phase — scheduled the first phase instead`);
  return 0;
}
