# Plan import API

`POST /api/admin/import-plan` writes a whole training plan — phases, days, exercises,
progression rules, deload weeks — into one profile's `state-<uid>.json`, without going
through the UI.

It exists for automation: loading a plan an LLM or a coach produced, and re-running it
whenever that plan changes. It is **off unless you switch it on**, and the key that switches
it on has full write access to the plan of whichever profile it names. See
[SELF_HOSTING.md](SELF_HOSTING.md#plan-import-api) before enabling it.

> **This is a fork-only feature.** It is not in upstream openGym. See the fork notes in the
> [README](../README.md#this-fork).

---

## 1. Enabling it

```bash
openssl rand -hex 32          # generate a key
```

Put it in `.env` next to `docker-compose.yml`:

```
IMPORT_API_KEY=<the 64 hex characters>
```

Then rebuild — the endpoint needs the API image built from source, because it imports the
app's own exercise catalogue out of `frontend/src/lib`:

```bash
docker compose up -d --build
```

| Env var | Default | What it does |
|---|---|---|
| `IMPORT_API_KEY` | *(unset)* | The service credential. **Unset ⇒ the endpoint answers 501 and does nothing.** |
| `IMPORT_RATE_MAX` | `10` | Requests allowed per window, per peer address. |
| `IMPORT_RATE_WINDOW_S` | `300` | The window, in seconds. |

## 2. Calling it

```
POST /api/admin/import-plan
X-Import-Key: <IMPORT_API_KEY>
Content-Type: application/json
```

| Where | Name | Meaning |
|---|---|---|
| query or body | `user_id` | Profile id (or exact profile name). Optional on a single-profile instance. |
| query or body | `dry_run` | `1` resolves everything and reports, and writes nothing. |
| body | `expected_ts` | Optimistic concurrency — see §2.1. Omit it to skip the check. |

Responses:

| Code | When |
|---|---|
| `200` | Imported (or dry-run). Body is the summary in §5. |
| `400` | The payload is not a plan (`no phases and no daily_postural_routine`, a bad `start_date`, an `expected_ts` that is not a number, bad JSON). |
| `401` | `X-Import-Key` missing or wrong. |
| `404` | No such profile. The body lists the profiles that do exist. |
| `409` | `expected_ts` was sent and the profile has moved since. Nothing was written — see §2.1. |
| `429` | Rate limited. `Retry-After` says how long. |
| `501` | `IMPORT_API_KEY` is not set on this instance. |

There is a machine-readable version of all of this in
[`api/openapi.yaml`](../api/openapi.yaml) (OpenAPI 3.1, `operationId: importPlan`) — that is
what an LLM with function calling should be handed, rather than this page.

### 2.1 `expected_ts` and `state_ts` — writing safely while the app exists

The app stamps `_ts` on every change and PUTs the **whole** state 1.5 s later
(`frontend/src/store/useStore.js`), and `PUT /api/data` does no version check. An import and a
phone in a pocket are therefore a last-writer-wins race in which nothing reports the loser.

Two fields make that visible:

* **Every successful response carries `state_ts`** — always *the value to send as `expected_ts`
  on your next call*. After a real import it is the timestamp just written; after a dry run it is
  the untouched one still on disk. So a caller can chain calls without a second route to read the
  state from, which is what an LLM needs.
* **Send `expected_ts` on the real call.** If the profile has moved since, the endpoint answers
  `409` and writes nothing:

```jsonc
{
  "error": "the profile changed since you read it — nothing was written",
  "expected_ts": 1788351179452,
  "actual_ts":   1788351401118,
  "hint": "run again with dry_run=1, read state_ts from the response, and retry with that value (or omit expected_ts to write regardless)"
}
```

`null` is a meaningful value, not a missing one: it says *"I planned against a profile that has
never synced"*, and is checked just as strictly as a number. **Omitting the field entirely** keeps
the old unchecked behaviour, so nothing already in use breaks.

The bundled script speaks it too:

```bash
node scripts/import-plan.mjs plan.json --dry-run                 # prints state_ts
node scripts/import-plan.mjs plan.json --expected-ts 1788351179452
```

What this does **not** solve is in §7.

The endpoint does **not** read a session cookie, does **not** use the admin dashboard's
`ADMIN_UIDS`, and never writes `db.json`. It can only rewrite the plan half of an existing
`state-<uid>.json`.

### With the bundled script

```bash
node scripts/import-plan.mjs plans/my-plan.json --dry-run
node scripts/import-plan.mjs plans/my-plan.json --url https://gym.example.com
```

The key comes from `--key`, then `IMPORT_API_KEY` in the environment, then `.env`. It is
never printed.

### With curl

```bash
curl -sS -X POST https://gym.example.com/api/admin/import-plan \
  -H "X-Import-Key: $IMPORT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @plans/my-plan.json
```

---

## 3. The payload

```jsonc
{
  "plan": "Plan 6 meses / 24 semanas",   // label, for the summary only
  "start_date": "2026-09-07",            // ISO date of the MONDAY of plan week 1
  "active_phase": "Fase 1 — Base",       // which phase fills the weekly schedule
  "emit_deload_routines": true,          // default true
  "deload_suffix": " (descarga)",        // default " (descarga)"
  "prune_phase_routines": false,         // default false — see §6.1
  "append_postural_to_training_days": true,   // default true
  "schedule_postural_on_rest_days": true,     // default true
  "postural_routine_name": "Postural diario",

  "phases": [ … ],                       // §3.1
  "daily_postural_routine": [ … ]        // §3.4
}
```

### 3.1 A phase

```jsonc
{
  "name": "Fase 2 — Construcción",
  "weeks": [9, 16],                      // documentation only — openGym has no plan weeks
  "progression_default": "double_progression",
  "deload_weeks": [12, 16],              // absolute plan weeks, 1-based
  "deload_volume_reduction": 0.4,        // 0.4 = 40 % fewer sets, same weight
  "days": [ … ],                         // §3.2
  "cardio": [ … ]                        // §3.3
}
```

`progression_default` accepts openGym's own policy names (`off`, `linear`, `greyskull`,
`double`, `time`) and the friendlier spellings (`double_progression`, `doble progresión`,
`greyskull_lp`, `linear_progression`, `tiempo`). Anything else is a warning and falls through
to the app's default.

### 3.2 A day

```jsonc
{
  "name": "Torso A",
  "repeat_days": ["Lunes", "Jueves"],    // Spanish or English weekday names
  "progression": "double_progression",    // optional, overrides the phase default
  "append_postural": false,               // optional, opt this day out of the postural block
  "exercises": [ … ]
}
```

### 3.3 An exercise

```jsonc
{
  "name": "Press de banca plano",        // matched against the catalogue — see §4
  "exercise_id": "0025",                 // optional; skips matching entirely
  "sets": 4,
  "reps": "8-10",                        // "10" or a range "8-10"
  "timed_s": "30-45",                    // a HOLD instead of reps → mode:'time'
  "duration_min": "20",                  // a CARDIO block instead → mode:'cardio'
  "speed": 8,                            //   km/h, cardio only
  "starting_weight_kg": "20-30",         // a range keeps its bottom end + the written form
  "rest_s": 90,
  "per_side": true,                      // reps counted per side (rep work only)
  "bodyweight": true,                    // overrides the catalogue's own equipment flag
  "progression": "greyskull_lp",         // per-exercise override
  "increment_kg": 2.5,                   // per-exercise load step
  "warmup_sets": 2,
  "superset_with": "Extensión de tríceps en polea",   // must be the NEXT or PREVIOUS exercise
  "tag": "postural",                     // free label — see the note below
  "note": "por pierna"
}
```

Behaviour worth knowing:

* **`timed_s` is what makes a plank a plank.** It writes `mode: 'time'` and `sec`. Without it,
  "45" is logged as 45 repetitions. A range takes its **bottom** end as the target, because
  the `time` progression policy is what raises it.
* **`starting_weight_kg` is a single number in openGym.** A range keeps its bottom end and the
  string you wrote lands in the exercise's note, so `"20-30"` becomes `weight: 20` plus a note
  reading `20-30`. `"10-15 por lado"` is the same: `weight: 10`, note kept.
* **`per_side` only applies to rep work.** `side` counts *repetitions* per side; a timed hold
  has none to split, and a per-side *weight* is a loading instruction, not a rep count. Both
  are kept as notes and reported as warnings.
* **`superset_with` names the other exercise.** openGym groups a superset with a shared `sg`
  key and only groups **adjacent** exercises — a pair that is not neighbouring is reported and
  left ungrouped rather than written as a group the app would silently drop.
* **`tag` is a note, not a tag.** openGym has no tag field on an exercise. `tag: "postural"`
  is written into `note`, which is visible in the routine editor and travels with a shared
  plan file, but the muscle map does not read it.
* **Double progression needs two bounds.** A flat `"reps": "10"` under a `double` policy is
  filled in through the app's own `normalizeRepRange` (→ `8-10`) and reported as a warning, so
  the range is visible in the editor instead of being implied at read time.

### 3.4 Cardio, and the daily postural routine

A phase's `cardio[]` entries become their own routines:

```jsonc
{ "name": "Cardio moderado", "days": ["Martes", "Sábado"], "type": "caminata rápida o bici",
  "duration_min": "25-30", "intensity": "moderada" }
```

`daily_postural_routine[]` is a list of exercises in the same shape as §3.3. It is used twice:

1. appended to the end of every training day's routine (`append_postural_to_training_days`), and
2. as a standalone routine assigned to every weekday the active phase leaves empty
   (`schedule_postural_on_rest_days`).

**Why both.** openGym resolves exactly one routine per calendar day (`effectiveRoutineId` in
`frontend/src/lib/history.js`): there is no "today's session *plus* a mobility block", and no
"rest day with light work" — a day without a routine is a rest day, full stop. Appending
covers the days you train; the standalone routine covers the days you do not.

---

## 4. How exercise names are resolved

In order, stopping at the first hit:

1. **`exercise_id`**, if given. A stated id that resolves to nothing is reported as unresolved
   rather than falling back to a lookalike.
2. **The catalogue, as written.** `matchExercise()` from `frontend/src/lib/import-csv.js` —
   the same matcher the CSV importer uses: curated aliases, then an exact word-bag match, then
   entries containing every word of the query *when exactly one candidate is that close*. Names
   are lower-cased, accent-stripped, and stripped of parenthesised notes (`(postural)`,
   `(pec deck)`) and of an `" o <alternativa>"` tail first.
3. **The catalogue, via Spanish.** The dataset is English-only and openGym's translated
   exercise names cover pt-BR and Hungarian, not Spanish, so `api/exercise-aliases.js` maps
   Spanish phrases onto the English wording the catalogue uses (or, where the dataset's own
   name is unguessable — a pec deck is a "lever seated fly" — straight onto the id).
4. **A custom exercise.** Anything left over is created in `state.customEx` with a body part
   inferred from the name, exactly like an exercise you add in the app. A custom with the same
   name and body part is reused rather than duplicated — that is what makes a second import
   idempotent.

An unresolved name **never aborts the import**. It is reported in the response and the rest
goes through.

The response tells you which route each exercise took (`via`): `explicit-id`, `catalogue`,
`catalogue-es`, `custom-existing`, `custom-new`.

---

## 5. The response

```jsonc
{
  "ok": true,
  "dry_run": false,
  "user_id": "abc123",
  "backup": "state-abc123.json.bak-2026-09-02T10-26-01-186Z",
  "state_ts": 1788351179452,          // send this back as expected_ts next time
  "counts": {
    "routines_created": 25, "routines_updated": 0,
    "exercises_matched": 60, "exercises_custom_created": 8, "exercises_custom_reused": 0,
    "exercises_unresolved": 0, "day_overrides": 30
  },
  "routines": { "created": ["F1 · Full Body", …], "updated": [], "removed": [] },
  "exercises": {
    "matched":        [{ "name": "Press de banca plano", "id": "0025", "via": "catalogue-es" }],
    "custom_created": [{ "name": "Chin tucks", "id": "mf9x1a2b3", "body_part": "neck" }],
    "custom_reused":  [],
    "unresolved":     [{ "name": "…", "reason": "…" }]
  },
  "week": { "1": "F1 · Full Body", "2": "F1 · Cardio moderado", … },
  "day_overrides": 30,
  "warnings": ["…"]
}
```

---

## 6. What it writes, and what it never touches

Written: `routines`, `week`, `dayPlan`, `customEx`, `_ts` — inside `state-<uid>.json` only.

### 6.1 `prune_phase_routines` — removing what the plan no longer has

**Off by default.** With it on, the import also **deletes** the routines that carry a phase
prefix this payload produces (`F2 · …`) and that this import did not just write — the ones a
previous shape of the same plan left behind when a training day is dropped or renamed.

It is scoped as narrowly as deletion can be:

* only routines whose name starts with a prefix **this payload generates**, so a routine you
  wrote yourself can never match — it has no prefix;
* only those **this import did not produce**;
* only when asked for explicitly.

It also clears what would otherwise dangle: `week` slots and `dayPlan` dates pointing at a
removed routine, plus deload dates that still point at a routine this plan manages but that the
plan no longer schedules — a plan that used to train on Saturdays leaves Saturday overrides
behind when it stops. Both would render as a rest day, which reads as a bug rather than as the
deliberate removal it is.

The response reports `routines.removed` (names) and `day_overrides_removed` (a count). The
automatic backup is taken exactly as on any other import, so a prune is one `mv` away from being
undone.

Never touched:

* `db.json` — profiles, passkey public keys, push subscriptions, invite codes. The WebAuthn
  flow is untouched; the endpoint cannot create, rename, disable or authenticate a profile.
* `workouts`, `bodyweight`, `exWeights`, and every setting (`unit`, `lang`, `theme`, …) in the
  state file. A plan import is not a history import.
* Routines you made yourself. Only routines whose **name** matches one the payload produces
  are updated, and they keep their id so the week schedule and the logged history stay
  attached to them.

Before every write, the previous `state-<uid>.json` is copied to
`state-<uid>.json.bak-<timestamp>` in the same `./data` directory. Reverting is `mv`. These
backups are never pruned — delete the old ones yourself.

---

## 7. Limits worth knowing before you rely on it

* **No lock against the web UI — `expected_ts` detects, it does not prevent.** The endpoint does
  read-modify-write on `state-<uid>.json`, and so does the app's own `PUT /api/data`.
  `expected_ts` turns "the import silently lost" into a `409` you can act on, and it covers the
  case where the app has already pushed. It does **not** cover an app sitting on changes it has
  not pushed yet: that push still lands after the import and still wins. There is no lock,
  because the browser does not take one and cannot be asked to.
  **Import with the app closed, or pull-to-refresh in the app immediately afterwards.**
  Also true of concurrent imports: two overlapping calls without `expected_ts` are a race
  between themselves. (The MCP server's roadmap flags the same gap for its planned write
  tools — see `mcp/README.md`; the fuller design is in `docs/LLM_INTEGRATION.md` §2.)
* **Phases are a naming convention, not a feature.** openGym has no mesocycles. Every
  phase × day becomes one flat routine named `F2 · Torso A`, and only the `active_phase` is
  written into the weekly schedule. Switching phase later means re-running the import with a
  different `active_phase` — the routines are already there, so nothing is recreated.
* **Deload weeks need `start_date`.** The twin routines are always created; writing them into
  the calendar (`dayPlan`) needs to know which Monday is week 1. Without it you get the
  routines and a warning.
* **openGym's double progression advances after one qualifying session, not two.** A plan that
  says "top of the range in every set for two consecutive sessions" cannot be expressed;
  `double` is the closest policy and is what gets written.
* **`user_id` is not a permission boundary.** One key can write any profile on the instance.
  It is a service credential for the operator, not a per-user token.
