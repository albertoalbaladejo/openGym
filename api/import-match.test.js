/* Exercise name → catalogue id, and the fallback to a user-owned custom exercise. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExercise, cleanName, bodyPartFor } from './exercise-resolve.js';
import { normalizeKey, englishFor } from './exercise-aliases.js';
import { EXIDX } from '../frontend/src/lib/exercises.js';

const ctx = () => { let n = 0; return { customEx: [], newCustom: [], uid: () => 'u' + (++n) }; };

test('normalizeKey strips accents, case and parenthesised notes', () => {
  assert.equal(normalizeKey('Elevación de talones (gemelos)'), 'elevacion de talones');
  assert.equal(normalizeKey('Face pull (postural)'), 'face pull');
  assert.equal(normalizeKey('Aperturas en máquina (pec deck)'), 'aperturas en maquina');
  // "o <alternativa>" is a choice, and the plan still has to resolve to one exercise
  assert.equal(normalizeKey('Sentadilla en máquina Smith o prensa de piernas'), 'sentadilla en maquina smith');
});

test('cleanName keeps the written name readable while dropping the note', () => {
  assert.equal(cleanName('Contractor inverso (reverse pec deck)'), 'Contractor inverso');
  assert.equal(cleanName('Dominadas asistidas o jalón al pecho'), 'Dominadas asistidas');
});

test('an English name resolves straight against the catalogue', () => {
  const r = resolveExercise({ name: 'Face pull' }, ctx());
  assert.equal(r.via, 'catalogue');
  assert.ok(EXIDX[r.id], 'resolved id is in the catalogue');
});

test('a Spanish name resolves through the alias table', () => {
  const cases = {
    'Press de banca plano': '0025',
    'Peso muerto rumano': '0085',
    'Prensa de piernas': '0739',
    'Aperturas en máquina (pec deck)': '0596',
    'Rueda abdominal (ab wheel)': '0857',
  };
  for (const [name, id] of Object.entries(cases)) {
    const r = resolveExercise({ name }, ctx());
    assert.equal(r.id, id, `${name} should resolve to ${id}, got ${r.id} (${r.via})`);
    assert.equal(r.via, 'catalogue-es');
  }
});

test('accents and parenthesised notes do not change the result', () => {
  const withAccents = resolveExercise({ name: 'Elevación de talones de pie (gemelos)' }, ctx());
  const without = resolveExercise({ name: 'Elevacion de talones de pie' }, ctx());
  assert.equal(withAccents.id, without.id);
  assert.ok(EXIDX[withAccents.id]);

  // The tag the encargo asks for must never reach the matcher.
  const tagged = resolveExercise({ name: 'Face pull (postural)' }, ctx());
  const plain = resolveExercise({ name: 'Face pull' }, ctx());
  assert.equal(tagged.id, plain.id);
});

test('a name the catalogue does not have becomes a custom exercise, not a failure', () => {
  const c = ctx();
  const r = resolveExercise({ name: 'Chin tucks' }, c);
  assert.equal(r.via, 'custom-new');
  assert.equal(c.newCustom.length, 1);
  assert.equal(c.newCustom[0].n, 'Chin tucks');
  assert.equal(c.newCustom[0].bp, 'neck');
  assert.equal(r.id, c.newCustom[0].id);
});

test('the same unknown name twice reuses the custom instead of duplicating it', () => {
  const c = ctx();
  const a = resolveExercise({ name: 'Wall angels' }, c);
  const b = resolveExercise({ name: 'wall angels' }, c);          // different casing
  const d = resolveExercise({ name: 'Wall angels (postural)' }, c); // and a note
  assert.equal(a.id, b.id);
  assert.equal(a.id, d.id);
  assert.equal(b.via, 'custom-existing');
  assert.equal(c.newCustom.length, 1);
});

test('a custom already in the profile is reused rather than recreated', () => {
  const c = ctx();
  c.customEx.push({ id: 'existing1', n: 'Wall angels', bp: 'shoulders' });
  const r = resolveExercise({ name: 'Wall angels' }, c);
  assert.equal(r.id, 'existing1');
  assert.equal(r.via, 'custom-existing');
  assert.equal(c.newCustom.length, 0);
});

test('an explicit exercise_id wins, and a bogus one is reported rather than guessed at', () => {
  const ok = resolveExercise({ name: 'whatever', exercise_id: '0025' }, ctx());
  assert.equal(ok.id, '0025');
  assert.equal(ok.via, 'explicit-id');

  const bad = resolveExercise({ name: 'Press de banca plano', exercise_id: 'nope' }, ctx());
  assert.equal(bad.id, null);
  assert.equal(bad.via, 'unresolved');
  assert.match(bad.reason, /not in the catalogue/);
});

test('an exercise with neither name nor id is unresolved, not invented', () => {
  const r = resolveExercise({ sets: 3 }, ctx());
  assert.equal(r.id, null);
  assert.equal(r.via, 'unresolved');
});

test('body parts for invented exercises come from the dataset vocabulary', () => {
  assert.equal(bodyPartFor('Chin tucks'), 'neck');
  assert.equal(bodyPartFor('Plancha lateral'), 'waist');
  assert.equal(bodyPartFor('HIIT corto'), 'cardio');
  // "jalón al pecho" is a pulldown: the word "pecho" must not file it under the chest
  assert.equal(bodyPartFor('Jalón al pecho agarre ancho'), 'back');
});

test('the alias table never points at an id the catalogue lost', () => {
  for (const name of ['Jalón al pecho', 'Aperturas en máquina', 'Fondos en máquina asistida', 'Rueda abdominal']) {
    const v = englishFor(name);
    if (v && v.startsWith('#')) assert.ok(EXIDX[v.slice(1)], `${name} → ${v} is not in the catalogue`);
  }
});
