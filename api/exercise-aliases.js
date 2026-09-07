/* Spanish exercise names → an English query the catalogue can actually match.
 *
 * The dataset (hasaneyldrm/exercises-dataset) is English-only, and openGym's translated
 * exercise names cover pt-BR and hu — not Spanish (i18n-core.js: EXERCISE_NAME_LANGS).
 * So a plan written in Spanish has nothing to match against. This table translates the
 * phrase into the English wording the catalogue uses, and the existing matchExercise()
 * from frontend/src/lib/import-csv.js does the actual resolution from there.
 *
 * Keys are normalised the same way lookups are (see normalizeKey below): lower-cased,
 * accents stripped, parenthesised notes removed, "o <alternativa>" tails dropped. So
 * "Sentadilla en máquina Smith o prensa de piernas" and "sentadilla en smith" both land
 * on the same key.
 *
 * A missing entry is not an error: the name falls through to matchExercise() as written,
 * and if that fails too the importer creates a custom exercise. This table only exists to
 * raise the hit rate on the catalogue for Spanish input.
 */

export const ES_TO_EN = {
  // ── piernas ──────────────────────────────────────────────────────────────
  'sentadilla en maquina smith': 'smith squat',
  'sentadilla en smith': 'smith squat',
  'hack squat': 'sled hack squat',
  'prensa de piernas': 'sled 45 leg press',
  'prensa': 'sled 45 leg press',
  'curl femoral tumbado': 'lever lying leg curl',
  'curl femoral sentado': 'lever seated leg curl',
  'curl femoral': 'lever lying leg curl',
  'extension de cuadriceps': 'lever leg extension',
  'extension de cuadriceps en maquina': 'lever leg extension',
  'peso muerto rumano': 'barbell romanian deadlift',
  'zancadas con mancuernas': 'dumbbell lunge',
  'maquina de abductores': 'lever seated hip abduction',
  'maquina de aductores': 'lever seated hip adduction',
  'elevacion de talones de pie': 'lever standing calf raise',
  'elevacion de talones sentado': '#0594',
  'elevacion de talones sentada': '#0594',   // la forma femenina caía al prefijo genérico,
                                             // que resuelve a la variante DE PIE — otro ejercicio
  'elevacion de talones': 'lever standing calf raise',
  'gemelos': 'lever standing calf raise',

  // ── empuje: pecho / hombro / triceps ──────────────────────────────────────
  'press de pecho en maquina': 'lever chest press',
  'press de banca plano': 'barbell bench press',
  'press de banca': 'barbell bench press',
  'press inclinado con mancuernas': 'dumbbell incline bench press',
  'press militar en maquina': 'lever military press',
  'press de hombro con mancuernas': 'dumbbell seated shoulder press',
  'elevaciones laterales con mancuernas': 'dumbbell lateral raise',
  'aperturas en maquina': '#0596',
  'pec deck': '#0596',
  'fondos en maquina asistida': '#0009',
  'extension de triceps en polea': 'cable pushdown',
  'extension de triceps en maquina': 'lever triceps extension',

  // ── tiron: espalda / biceps ───────────────────────────────────────────────
  'remo sentado en maquina': 'lever seated row',
  'remo sentado': 'cable seated row',
  'remo sentado agarre neutro': 'cable seated row',
  'remo en polea baja agarre en v': 'cable seated row',
  'remo en polea baja agarre ancho': 'cable seated wide grip row',
  'jalon al pecho': '#2330',
  'jalon al pecho agarre ancho': '#2330',
  'dominadas asistidas': 'assisted pull-up',
  'curl de biceps en maquina': 'lever preacher curl',
  'curl de biceps con mancuernas': 'dumbbell biceps curl',
  'curl martillo con mancuernas': 'dumbbell hammer curl',

  // ── postural ──────────────────────────────────────────────────────────────
  'face pull': 'cable rear delt row rope',
  'contractor inverso': 'lever reverse fly',
  'reverse pec deck': 'lever reverse fly',

  // El catálogo no tiene bird-dog ni el superman de extensión lumbar: lo único parecido de
  // nombre es 'superman push-up', una flexión pliométrica de pecho. Dejar que el matcher
  // acierte por el nombre archivaría trabajo lumbar suave bajo un ejercicio explosivo de
  // empuje. '!custom' fuerza un ejercicio propio, que es la respuesta honesta.
  // Ojo con la clave: normalizeKey corta el " o <alternativa>", así que
  // "Superman o pájaro-perro" se busca como 'superman'.
  'superman': '!custom',
  'pajaro perro': '!custom',
  'bird dog': '!custom',

  // ── core ──────────────────────────────────────────────────────────────────
  // Planks: the dataset has no plain front/side plank — only 'weighted front plank' and
  // 'side plank hip adduction', which are different exercises. Deliberately left unmapped so
  // the importer creates an honest custom exercise instead of filing holds under a lookalike.
  'crunch en maquina de abdominales': 'lever seated crunch',
  'abdominales en maquina': 'lever seated crunch',
  'crunch en polea alta': 'cable kneeling crunch',
  'elevacion de piernas colgado': 'hanging leg raise',
  'rueda abdominal': '#0857',
  'ab wheel': '#0857',

  // ── cardio ────────────────────────────────────────────────────────────────
  'caminata rapida': 'walking on treadmill',
  'cinta': 'walking on treadmill',
  'bici': 'stationary bike',
  'bicicleta': 'stationary bike'
};

/* Normalise a written exercise name into a lookup key.
 *  - NFD + strip combining marks: "extensión" → "extension"
 *  - drop parenthesised notes: "Elevación de talones (gemelos)" → "elevacion de talones"
 *    (the encargo asks for exactly this, and "(postural)" must never reach the matcher)
 *  - drop an " o <alternativa>" tail: a plan that offers a choice still has to resolve to one
 *  - collapse whitespace and punctuation the catalogue does not carry
 */
export function normalizeKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+o\s+.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* A table value may be a direct catalogue id written as '#0596'. Some entries have no
 * English wording the matcher can find (the dataset calls a pec deck a "lever seated fly"),
 * and guessing at a phrase that happens to match is worse than naming the id outright. */
export const isDirectId = v => typeof v === 'string' && /^#[A-Za-z0-9_-]+$/.test(v);

/* '!custom' says: do not let the matcher have this one. Used where the catalogue happens to
 * contain something with a similar NAME and a different MEANING, which is the one case the
 * matcher cannot get right on its own — it only sees words. */
export const FORCE_CUSTOM = '!custom';
export const isForceCustom = v => v === FORCE_CUSTOM;

/** Only the exact curated entry, no prefix fallback. A human wrote this one down on purpose,
 *  so it outranks the generic matcher; the prefix fallback does not, and stays after it. */
export function exactFor(name) {
  const key = normalizeKey(name);
  return key && Object.prototype.hasOwnProperty.call(ES_TO_EN, key) ? ES_TO_EN[key] : null;
}

/** The English query (or '#id') for a Spanish name, or null when the table has nothing to say. */
export function englishFor(name) {
  const key = normalizeKey(name);
  if (!key) return null;
  if (ES_TO_EN[key]) return ES_TO_EN[key];
  // Longest-prefix fallback: "elevacion de talones de pie gemelos" still finds
  // "elevacion de talones de pie". Longest key first so the specific entry wins.
  const hit = Object.keys(ES_TO_EN)
    .filter(k => key.startsWith(k + ' ') || key === k)
    .sort((a, b) => b.length - a.length)[0];
  return hit ? ES_TO_EN[hit] : null;
}
