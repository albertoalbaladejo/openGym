/* The payload → state mapping, and the promise that importing twice changes nothing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPlan, parseReps, parseSeconds, parseWeight, parseWeekday, normalizeProgression } from './import-plan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'plans/plan-alberto-6-meses.json'), 'utf8'));

const emptyState = () => ({ routines: [], week: {}, dayPlan: {}, customEx: [] });
const minter = () => { let n = 0; return () => 'r' + (++n); };
const bare = s => { const c = structuredClone(s); delete c._ts; return c; };

/* ---------- the small parsers ---------- */

test('reps: a single target, a range, and nothing', () => {
  assert.deepEqual(parseReps('12'), { reps: 12 });
  assert.deepEqual(parseReps('8-10'), { repsMin: 8, reps: 10 });
  assert.deepEqual(parseReps('15-20'), { repsMin: 15, reps: 20 });
  assert.deepEqual(parseReps(10), { reps: 10 });
  assert.equal(parseReps(''), null);
  assert.equal(parseReps(null), null);
});

test('a prescribed hold takes the bottom of the range as its target', () => {
  assert.equal(parseSeconds('30-45'), 30);
  assert.equal(parseSeconds('45'), 45);
  assert.equal(parseSeconds(null), null);
});

test('a weight range keeps its bottom end and its written form', () => {
  assert.deepEqual(parseWeight('20-30'), { weight: 20, text: '20-30' });
  assert.deepEqual(parseWeight('10-15 por lado'), { weight: 10, text: '10-15 por lado' });
  assert.deepEqual(parseWeight(40), { weight: 40, text: null });
  assert.equal(parseWeight(''), null);
});

test('weekdays, in Spanish, with a note, and not at all', () => {
  assert.equal(parseWeekday('Lunes'), 1);
  assert.equal(parseWeekday('Miércoles'), 3);
  assert.equal(parseWeekday('Sábado (opcional)'), 6);
  assert.equal(parseWeekday('Domingo'), 0);
  assert.equal(parseWeekday('variable'), null);
  assert.equal(parseWeekday('2-3x/semana'), null);
});

test('progression names map onto openGym policies, and only onto those', () => {
  assert.equal(normalizeProgression('double_progression'), 'double');
  assert.equal(normalizeProgression('doble progresión'), 'double');
  assert.equal(normalizeProgression('Greyskull LP'), 'greyskull');
  assert.equal(normalizeProgression('linear'), 'linear');
  assert.equal(normalizeProgression('time'), 'time');
  assert.equal(normalizeProgression('rpe-autoregulated'), null);
  assert.equal(normalizeProgression(undefined), null);
});

/* ---------- the mapping ---------- */

test('the plan lands as routines, a week and a set of custom exercises', () => {
  const s = emptyState();
  const r = importPlan(s, PLAN, { uid: minter() });
  assert.ok(s.routines.length > 0);
  assert.equal(r.exercises.unresolved.length, 0, 'nothing in the plan should be dropped');
  assert.ok(r.exercises.matched.length > 40, 'most of the plan resolves against the catalogue');
  assert.ok(s.customEx.length > 0, 'the rest becomes custom exercises');
  const customIds = new Set(s.customEx.map(c => c.id));
  s.routines.forEach(rt => rt.ex.forEach(e => {
    assert.ok(typeof e.id === 'string' && e.id.length > 0, 'exercise has an id');
    assert.ok(/^\d{4}$/.test(e.id) || customIds.has(e.id), `${e.id} is neither a catalogue id nor a custom of this profile`);
  }));
});

test('a timed hold carries mode:"time" — without it 45 seconds becomes 45 reps', () => {
  const s = emptyState();
  importPlan(s, PLAN, { uid: minter() });
  const plank = s.routines.find(r => r.name === 'F2 · Full Body C').ex.find(e => e.mode === 'time');
  assert.ok(plank, 'the side plank is written as a timed exercise');
  assert.equal(plank.sec, 30);
  assert.equal(plank.reps, undefined);
  assert.equal(plank.side, undefined);
});

test('a superset is a shared sg on two adjacent exercises', () => {
  const s = emptyState();
  importPlan(s, PLAN, { uid: minter() });
  const ex = s.routines.find(r => r.name === 'F2 · Full Body A').ex;
  const grouped = ex.map((e, i) => [e, i]).filter(([e]) => e.sg);
  assert.equal(grouped.length, 2, 'exactly one pair is grouped');
  assert.equal(grouped[0][0].sg, grouped[1][0].sg, 'the pair shares one group id');
  assert.equal(Math.abs(grouped[0][1] - grouped[1][1]), 1, 'openGym only groups neighbours');
});

test('the postural block rides on every training day and owns the rest days', () => {
  const s = emptyState();
  const r = importPlan(s, PLAN, { uid: minter() });
  const full = s.routines.find(x => x.name === 'F1 · Full Body');
  assert.ok(full.ex.filter(e => (e.note || '').includes('postural')).length >= 3);
  assert.ok(s.routines.find(x => x.name === 'Postural diario'), 'a standalone postural routine exists');
  assert.equal(Object.keys(r.week).length, 7);
});

test('deload routines cut volume, keep the weight, and opt out of progression', () => {
  const s = emptyState();
  importPlan(s, PLAN, { uid: minter() });
  const normal = s.routines.find(r => r.name === 'F2 · Full Body A');
  const deload = s.routines.find(r => r.name === 'F2 · Full Body A (descarga)');
  assert.ok(deload);
  assert.equal(deload.excludeFromProgression, true);
  normal.ex.forEach((e, i) => {
    assert.ok(deload.ex[i].sets < e.sets || e.sets === 1, 'fewer sets');
    assert.equal(deload.ex[i].weight, e.weight, 'same weight');
  });
});

test('deload weeks are written into dayPlan when the plan says when it starts', () => {
  const s = emptyState();
  const r = importPlan(s, PLAN, { uid: minter() });
  assert.ok(r.day_overrides > 0);
  const deloadIds = new Set(s.routines.filter(x => x.excludeFromProgression).map(x => x.id));
  Object.values(s.dayPlan).forEach(id => assert.ok(deloadIds.has(id), 'every override points at a deload routine'));

  const s2 = emptyState();
  const { start_date, ...noStart } = PLAN;
  const r2 = importPlan(s2, noStart, { uid: minter() });
  assert.equal(r2.day_overrides, 0);
  assert.ok(r2.warnings.some(w => /start_date/.test(w)));
});

test('only the active phase is scheduled — a weekday holds one routine', () => {
  const s = emptyState();
  const r = importPlan(s, { ...PLAN, active_phase: 'Fase 3 — Definición' }, { uid: minter() });
  const scheduled = Object.values(r.week);
  assert.ok(scheduled.some(n => n.startsWith('F3 ·')));
  assert.ok(!scheduled.some(n => n.startsWith('F1 ·')), 'the other phases are created but unscheduled');
  assert.ok(s.routines.some(x => x.name.startsWith('F1 ·')), '…and still created');
});

/* ---------- idempotency ---------- */

test('importing the same plan twice changes nothing at all', () => {
  const s = emptyState();
  const uid = minter();
  const first = importPlan(s, PLAN, { uid });
  const after = bare(s);
  const second = importPlan(s, PLAN, { uid });

  assert.deepEqual(bare(s), after, 'the state is byte-identical the second time');
  assert.equal(second.routines.created.length, 0, 'nothing new was created');
  assert.equal(second.routines.updated.length, first.routines.created.length, 'everything was updated in place');
  assert.equal(second.exercises.custom_created.length, 0, 'no duplicate custom exercises');
  assert.equal(second.exercises.custom_reused.length, first.exercises.custom_created.length);
});

test('a routine keeps its id across imports, so the week and the history stay attached', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const before = Object.fromEntries(s.routines.map(r => [r.name, r.id]));
  importPlan(s, PLAN, { uid });
  s.routines.forEach(r => assert.equal(r.id, before[r.name], `${r.name} changed id`));
});

test('an edited plan updates the routine rather than adding a second one', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const count = s.routines.length;

  const edited = structuredClone(PLAN);
  edited.phases[0].days[0].exercises[0].sets = 5;
  importPlan(s, edited, { uid });

  assert.equal(s.routines.length, count, 'no routine was duplicated');
  assert.equal(s.routines.find(r => r.name === 'F1 · Full Body').ex[0].sets, 5);
});

test('an import never touches workouts, weigh-ins or settings', () => {
  const s = { ...emptyState(), unit: 'lb', workouts: [{ id: 'w1' }], bodyweight: [{ d: '2026-01-01', w: 80 }], exWeights: { '0025': 60 } };
  importPlan(s, PLAN, { uid: minter() });
  assert.equal(s.unit, 'lb');
  assert.deepEqual(s.workouts, [{ id: 'w1' }]);
  assert.deepEqual(s.bodyweight, [{ d: '2026-01-01', w: 80 }]);
  assert.deepEqual(s.exWeights, { '0025': 60 });
});

test('a routine the user made themselves is left alone', () => {
  const s = emptyState();
  s.routines.push({ id: 'mine', name: 'Mi rutina', ex: [{ id: '0025', sets: 3, reps: 5 }] });
  importPlan(s, PLAN, { uid: minter() });
  const mine = s.routines.find(r => r.id === 'mine');
  assert.deepEqual(mine.ex, [{ id: '0025', sets: 3, reps: 5 }]);
});

test('a payload with no phases and no postural routine is a 400, not an empty import', () => {
  assert.throws(() => importPlan(emptyState(), {}, { uid: minter() }), /no phases/);
  assert.throws(() => importPlan(emptyState(), { ...PLAN, start_date: 'ayer' }, { uid: minter() }), /ISO date/);
});

/* ---------- prune_phase_routines ---------- */

test('without the flag, a plan that drops a day leaves the old routine behind', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const before = s.routines.length;

  const shrunk = structuredClone(PLAN);
  shrunk.prune_phase_routines = false;                         // the plan file ships it on
  shrunk.phases[1].days = shrunk.phases[1].days.slice(0, 1);   // one day instead of three
  const r = importPlan(s, shrunk, { uid });

  assert.equal(r.routines.removed.length, 0, 'nothing is deleted unless asked');
  assert.equal(s.routines.length, before, 'the dropped days are still there, just unscheduled');
});

test('with the flag, the routines this plan no longer produces are removed', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const namesBefore = s.routines.map(r => r.name);

  const shrunk = structuredClone(PLAN);
  shrunk.prune_phase_routines = true;
  const dropped = shrunk.phases[1].days.slice(1).map(d => d.name);
  shrunk.phases[1].days = shrunk.phases[1].days.slice(0, 1);
  const r = importPlan(s, shrunk, { uid });

  assert.ok(r.routines.removed.length > 0);
  dropped.forEach(name => {
    assert.ok(namesBefore.some(n => n.endsWith('· ' + name)), 'it existed before');
    assert.ok(!s.routines.some(x => x.name.endsWith('· ' + name)), `${name} was removed`);
    assert.ok(!s.routines.some(x => x.name.endsWith('· ' + name + ' (descarga)')), `${name}'s deload twin went too`);
  });
});

test('pruning never touches a routine the user wrote themselves', () => {
  const s = emptyState();
  const uid = minter();
  s.routines.push({ id: 'mine', name: 'Mi rutina', ex: [{ id: '0025', sets: 3, reps: 5 }] });
  importPlan(s, { ...PLAN, prune_phase_routines: true }, { uid });
  importPlan(s, { ...PLAN, prune_phase_routines: true }, { uid });
  const mine = s.routines.find(r => r.id === 'mine');
  assert.ok(mine, 'a routine with no phase prefix can never match the prune');
  assert.deepEqual(mine.ex, [{ id: '0025', sets: 3, reps: 5 }]);
});

test('pruning clears the week slots and day overrides left dangling', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });

  const shrunk = structuredClone(PLAN);
  shrunk.prune_phase_routines = true;
  shrunk.phases[1].days = shrunk.phases[1].days.slice(0, 1);
  importPlan(s, shrunk, { uid });

  const live = new Set(s.routines.map(r => r.id));
  Object.values(s.week).forEach(id => assert.ok(live.has(id), 'no week slot points at a deleted routine'));
  Object.values(s.dayPlan).forEach(id => assert.ok(live.has(id), 'no day override points at a deleted routine'));
});

test('pruning drops the deload dates the plan no longer schedules', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const before = Object.keys(s.dayPlan).length;

  // The same plan trained on fewer weekdays: the dates it used to override must not linger.
  const fewer = structuredClone(PLAN);
  fewer.prune_phase_routines = true;
  fewer.phases[0].days[0].repeat_days = ['Lunes'];
  importPlan(s, fewer, { uid });

  assert.ok(Object.keys(s.dayPlan).length < before, 'the abandoned dates are gone');
  const live = new Set(s.routines.map(r => r.id));
  Object.values(s.dayPlan).forEach(id => assert.ok(live.has(id)));
});

test('pruning stays idempotent — a second identical import removes nothing', () => {
  const s = emptyState();
  const uid = minter();
  const p = { ...PLAN, prune_phase_routines: true };
  importPlan(s, p, { uid });
  const after = bare(s);
  const second = importPlan(s, p, { uid });
  assert.equal(second.routines.removed.length, 0);
  assert.deepEqual(bare(s), after, 'the state is byte-identical the second time');
});

/* ---------- phase_owns_week ---------- */

test('without the flag, a weekday the plan stops filling keeps what was there', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const tuesdayBefore = s.week[2];
  assert.ok(tuesdayBefore, 'the plan fills Tuesday');

  const noCardio = structuredClone(PLAN);
  noCardio.phases.forEach(p => (p.cardio || []).forEach(c => { c.days = []; }));
  noCardio.schedule_postural_on_rest_days = false;
  importPlan(s, noCardio, { uid });

  assert.equal(s.week[2], tuesdayBefore, 'Tuesday still points at the routine it used to');
});

test('phase_owns_week makes every unnamed weekday a real rest day', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });

  const only3 = structuredClone(PLAN);
  only3.phase_owns_week = true;
  only3.schedule_postural_on_rest_days = false;
  only3.phases.forEach(p => (p.cardio || []).forEach(c => { c.days = []; }));
  const r = importPlan(s, only3, { uid });

  assert.deepEqual(Object.keys(s.week).sort(), ['1', '3', '5'], 'only Mon/Wed/Fri are scheduled');
  [0, 2, 4, 6].forEach(d => assert.equal(s.week[d], undefined, `weekday ${d} is rest`));
  assert.equal(Object.keys(r.week).length, 3);
});

test('phase_owns_week also drops the deload dates the plan no longer schedules', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const before = Object.keys(s.dayPlan).length;

  const only3 = structuredClone(PLAN);
  only3.phase_owns_week = true;
  only3.schedule_postural_on_rest_days = false;
  only3.phases.forEach(p => (p.cardio || []).forEach(c => { c.days = []; }));
  const r = importPlan(s, only3, { uid });

  assert.ok(Object.keys(s.dayPlan).length < before, 'the abandoned dates are gone');
  assert.ok(r.day_overrides_removed > 0);
  // every date that survives falls on a weekday the plan still trains
  Object.keys(s.dayPlan).forEach(iso => {
    const wd = new Date(iso + 'T12:00:00').getDay();
    assert.ok([1, 3, 5].includes(wd), `${iso} is a weekday the plan no longer trains`);
  });
});

test('phase_owns_week leaves the routines themselves alone', () => {
  const s = emptyState();
  const uid = minter();
  importPlan(s, PLAN, { uid });
  const count = s.routines.length;

  const only3 = structuredClone(PLAN);
  only3.phase_owns_week = true;
  only3.phases.forEach(p => (p.cardio || []).forEach(c => { c.days = []; }));
  const r = importPlan(s, only3, { uid });

  assert.equal(s.routines.length, count, 'unscheduling is not deleting');
  assert.equal(r.routines.removed.length, 0);
  assert.ok(s.routines.some(x => /Cardio/.test(x.name)), 'the cardio routines are still there to reactivate by hand');
});

/* ---------- description on a custom exercise ---------- */

test('a description lands on the custom exercise, capped like the app caps it', () => {
  const s = emptyState();
  const uid = minter();
  const p = {
    daily_postural_routine: [
      { name: 'Chin tucks', sets: 3, reps: '10', description: 'Sentada, barbilla atrás. Aguanta 5 s.' },
      { name: 'Wall angels', sets: 3, reps: '10', description: 'x'.repeat(1500) },
    ],
  };
  importPlan(s, p, { uid });
  const chin = s.customEx.find(c => c.n === 'Chin tucks');
  assert.equal(chin.desc, 'Sentada, barbilla atrás. Aguanta 5 s.');
  assert.equal(s.customEx.find(c => c.n === 'Wall angels').desc.length, 1000, 'same 1000-char cap as sheets.jsx');
});

test('a description updates a custom the profile already has', () => {
  const s = emptyState();
  const uid = minter();
  s.customEx.push({ id: 'existing', n: 'Chin tucks', bp: 'neck' });   // no desc, as the importer used to create them
  importPlan(s, { daily_postural_routine: [{ name: 'Chin tucks', sets: 3, reps: '10', description: 'Barbilla atrás, 5 s.' }] }, { uid });

  assert.equal(s.customEx.length, 1, 'reused, not duplicated');
  assert.equal(s.customEx[0].id, 'existing');
  assert.equal(s.customEx[0].desc, 'Barbilla atrás, 5 s.');
});

test('no description leaves an existing one untouched', () => {
  const s = emptyState();
  const uid = minter();
  s.customEx.push({ id: 'existing', n: 'Chin tucks', bp: 'neck', desc: 'lo que ya había' });
  importPlan(s, { daily_postural_routine: [{ name: 'Chin tucks', sets: 3, reps: '10' }] }, { uid });
  assert.equal(s.customEx[0].desc, 'lo que ya había');
});
