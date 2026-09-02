/* Resolve a written exercise name to a catalogue id, or to a user-owned custom exercise.
 *
 * Everything that can be reused is reused: matchExercise() from the CSV importer does the
 * actual catalogue lookup (curated aliases → exact word-bag → single-candidate containment),
 * EXIDX is the catalogue index the whole app reads, and normalizeStr is the app's own
 * accent-stripping. What is new here is only what the app never needed:
 *   1. Spanish input (the dataset is English-only; EXERCISE_NAME_LANGS is pt-BR + hu),
 *   2. stripping "(postural)"-style parenthesised notes before matching,
 *   3. creating a custom exercise instead of dropping an unresolved name.
 */
import { matchExercise } from '../frontend/src/lib/import-csv.js';
import { EXIDX, normalizeStr, BODYPARTS } from '../frontend/src/lib/exercises.js';
import { englishFor, normalizeKey, isDirectId } from './exercise-aliases.js';

/** Name as the matcher should see it: no parenthesised note, no " o <alternativa>" tail. */
export const cleanName = name => String(name || '')
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\s+o\s+.*$/i, '')
  .replace(/\s+/g, ' ')
  .trim();

// Body part for an invented exercise, over the dataset's own vocabulary (BODYPARTS).
// Spanish and English in one table because a plan mixes both ("Wall angels", "Plancha lateral").
const NAME_BP = [
  [/\b(cuello|chin tuck|chin tucks|neck)\b/, 'neck'],
  [/\b(muneca|antebrazo|antebrazos|wrist|forearm|forearms|grip)\b/, 'lower arms'],
  [/\b(gemelo|gemelos|soleo|talones|calf|calves)\b/, 'lower legs'],
  [/\b(biceps|triceps|curl|extension de triceps|pushdown|skullcrusher)\b/, 'upper arms'],
  // Back before chest: "jalón al pecho" is a pulldown, and the chest rule would otherwise
  // claim it on the word "pecho" alone.
  [/\b(remo|jalon|dominada|dominadas|espalda|dorsal|dorsales|peso muerto|encogimiento|row|pulldown|pullup|pull up|chin up|lat|lats|back|deadlift|shrug)\b/, 'back'],
  [/\b(pecho|pectoral|banca|aperturas|fondos|bench|chest|pec|fly|flye|crossover|dip)\b/, 'chest'],
  [/\b(hombro|hombros|deltoides|militar|elevaciones laterales|face pull|contractor inverso|wall angel|wall angels|shoulder|delt|delts|overhead|lateral raise|front raise|press up)\b/, 'shoulders'],
  [/\b(sentadilla|prensa|zancada|zancadas|femoral|cuadriceps|gluteo|gluteos|abductor|abductores|aductor|aductores|pierna|piernas|squat|lunge|leg|glute|hamstring|quad|hip thrust)\b/, 'upper legs'],
  [/\b(abdominal|abdominales|core|plancha|crunch|oblicuo|oblicuos|rueda abdominal|ab|abs|plank|sit up|oblique|russian twist)\b/, 'waist'],
  [/\b(cardio|caminata|correr|bici|bicicleta|cinta|eliptica|remoergometro|hiit|intervalos|run|running|jog|bike|cycling|rope|jump|jacks|burpee|sprint|treadmill|stair)\b/, 'cardio'],
];

/** Dataset body part for a name we are inventing an exercise for. Never returns an unknown one. */
export function bodyPartFor(name) {
  const k = normalizeKey(name);
  const hit = (NAME_BP.find(([re]) => re.test(k)) || [])[1];
  return hit && BODYPARTS.includes(hit) ? hit : 'full body';
}

/**
 * Resolve one exercise.
 *
 * @param {object} ex        payload exercise ({ name, exercise_id? })
 * @param {object} ctx       { customEx, newCustom, uid }  — customEx is the user's existing list,
 *                           newCustom collects the ones this import creates, uid() mints ids.
 * @returns {{ id, via, name, created? }} `via` is one of:
 *          'explicit-id' | 'catalogue' | 'catalogue-es' | 'custom-existing' | 'custom-new'
 *          …or `{ id: null, via: 'unresolved', reason }` when there is not even a name to invent from.
 */
export function resolveExercise(ex, ctx) {
  const raw = String(ex?.name || '').trim();

  // 1. An explicit id always wins — a payload that already knows the catalogue id should not
  //    be second-guessed by a name matcher. Accepts a custom id the profile already holds.
  const explicit = String(ex?.exercise_id || '').trim();
  if (explicit) {
    const known = EXIDX[explicit] || (ctx.customEx || []).find(c => c.id === explicit)
      || (ctx.newCustom || []).find(c => c.id === explicit);
    if (known) return { id: explicit, via: 'explicit-id', name: raw || known.n || explicit };
    // A stated id that resolves to nothing is a payload mistake worth surfacing, not a silent
    // fallback that files the work under a lookalike.
    return { id: null, via: 'unresolved', name: raw, reason: `exercise_id "${explicit}" is not in the catalogue and not a custom exercise of this profile` };
  }

  if (!raw) return { id: null, via: 'unresolved', name: '', reason: 'exercise has neither name nor exercise_id' };

  // 2. The catalogue, as written (handles names already in English: "Face pull", "Hack squat").
  const stripped = cleanName(raw);
  const direct = matchExercise(stripped);
  if (direct && EXIDX[direct]) return { id: direct, via: 'catalogue', name: raw };

  // 3. The catalogue, via the curated Spanish → English phrase table.
  const en = englishFor(raw);
  if (en) {
    if (isDirectId(en)) {
      const direct2 = en.slice(1);
      if (EXIDX[direct2]) return { id: direct2, via: 'catalogue-es', name: raw, query: en };
    } else {
      const viaEs = matchExercise(en);
      if (viaEs && EXIDX[viaEs]) return { id: viaEs, via: 'catalogue-es', name: raw, query: en };
    }
  }

  // 4. A custom exercise. Reused when the profile (or this same import) already has one with
  //    the same name and body part — the rule mergePlan already uses, and what makes a second
  //    run of the same plan reuse rather than duplicate.
  const bp = bodyPartFor(raw);
  const key = normalizeStr(stripped);
  const same = [...(ctx.customEx || []), ...(ctx.newCustom || [])]
    .find(c => normalizeStr(cleanName(c.n)) === key && c.bp === bp);
  if (same) return { id: same.id, via: 'custom-existing', name: raw };

  const created = { id: ctx.uid(), n: stripped, bp };
  ctx.newCustom.push(created);
  return { id: created.id, via: 'custom-new', name: raw, created };
}
