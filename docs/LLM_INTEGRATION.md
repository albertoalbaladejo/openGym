# Letting an external LLM write a plan into openGym

**Status: partly implemented.** Steps 1–3 of §5 shipped on 2026-09-02 — the endpoint is in
`api/openapi.yaml`, and `expected_ts` / `state_ts` / `409` exist and are tested. Steps 4–8 are
**not** built; §6 says exactly what is still missing and why it was deferred.

The goal: describe a plan in words to an LLM — *"a 4-day strength plan, prioritise legs"* — and
have it land in openGym, without anyone hand-building JSON.

Two pieces already exist and neither is duplicated here:

| Piece | What it is | Direction |
|---|---|---|
| [`mcp/`](../mcp/README.md) | stdio MCP server, spawned by the LLM client, reads `./data` directly | **read only** |
| [`POST /api/admin/import-plan`](IMPORT_API.md) | HTTP endpoint, `X-Import-Key`, idempotent, exercise matching, backup-before-write | **write** |

The write path is already built. What is missing is not a second write path — it is **a contract
an LLM can hit without a human in the middle**, and **a concurrency story**, because today the
only thing standing between an LLM's write and the phone in your pocket is the sentence "import
with the app closed".

---

## 1. Where the write path should live

### 1.1 What the MCP server actually is

From `mcp/README.md` and `mcp/src/`:

* **stdio transport.** `mcp/src/index.js` connects a `StdioServerTransport`; the LLM *client*
  spawns the process and talks JSON-RPC over stdin/stdout.
* **Filesystem access.** `mcp/src/state.js` reads `OPENGYM_DATA/db.json` and
  `state-<uid>.json` straight off the disk, caches by `mtime`, watches with `fs.watch`.
* **No network, no auth.** The README is explicit: *"The filesystem is the boundary."*

That has a consequence the roadmap does not spell out: **the MCP server only works when the LLM
client runs on the same machine as `./data`.**

Which is not this setup. `./data` is on the VPS. The LLM is "vía API externa, no necesariamente
Claude Code" — a model behind an HTTP API, somewhere else entirely. An stdio process it cannot
spawn, reading a disk it cannot see, is not a path to anything.

`mcp/README.md`'s own roadmap already names the missing piece — but it is **Phase 3**, not Phase 2:

> **Phase 3:** Streamable HTTP transport, opt-in 4th container in `docker-compose.yml`.

So "extend the MCP" is really "build Phase 3 *and* Phase 2": a new container, a new exposed port,
a new vhost, a new certificate, and a new long-lived-token auth path (`./data/tokens.json`) — all
so an LLM can reach a machine it can already reach over `https://gym.albertoalbaladejo.com`.

### 1.2 The two options, side by side

| | **A — extend `mcp/` (its Phase 2 + 3)** | **B — the HTTP endpoint as an LLM tool** |
|---|---|---|
| Reachable from an external LLM API | only after Phase 3 (HTTP transport) | **today** |
| New containers | 1 (4th service) | 0 |
| New auth path | yes (`./data/tokens.json`, long-lived tokens) | no — `IMPORT_API_KEY` already exists |
| New nginx vhost + cert | yes | no |
| Write paths into `state-<uid>.json` | **two** (MCP writes `./data` directly, endpoint writes it too) | **one** |
| Locking | must cover both paths | one place to lock |
| Audit trail | second one, or none | `import.plan` / `import.denied`, already there |
| Idempotency + matching | reimplemented, or imported across package boundaries | already there |
| Which LLMs can use it | only MCP-capable clients | **any** model with function calling |
| Works from Claude Desktop on the laptop | yes | yes (over HTTPS) |

### 1.3 Recommendation

**B as the primary, with a thin MCP tool on top of it as a secondary — not a parallel
implementation.**

Concretely:

1. **Document `POST /api/admin/import-plan` in `api/openapi.yaml`.** That file already exists:
   1398 lines of hand-written OpenAPI 3.1 covering *every* route the server registers, including
   all of `/api/admin/*`. Its own header says: *"if you add a route there, add it here too."*
   **The fork's endpoint is the one route missing from it.** Adding it is the entire "make it
   callable by an LLM" story for every function-calling model on the market — OpenAPI 3.1 is what
   they consume, directly or via a one-file converter.

2. **Add a `securitySchemes` entry** for the `X-Import-Key` header (`type: apiKey, in: header`),
   next to the existing `cookieAuth` / `bearerAuth`.

3. **If and when an MCP write tool is wanted**, make it an **HTTP client of that same endpoint**,
   not a second writer over `./data`:

   ```
   LLM ──MCP stdio──▶ mcp/src/tools.js: import_plan ──HTTPS──▶ POST /api/admin/import-plan
   LLM ──function calling / OpenAPI──────────────────HTTPS──▶ POST /api/admin/import-plan
   ```

   One write path, one lock, one audit trail, one idempotency implementation. The MCP read tools
   keep reading `./data` directly — that stays correct and fast, and read/write asymmetry is
   honest here: reads are local and cheap, writes need the concurrency guarantees only the server
   can give.

   Cost: the MCP process gains a network call and an env var (`OPENGYM_URL`, `OPENGYM_IMPORT_KEY`).
   That does breach the README's "no telemetry, no network" line, so it must be **opt-in**: no
   key configured, no write tool registered — the same shape as `IMPORT_API_KEY` itself.

This diverges from `mcp/README.md`'s stated Phase 2 (direct `./data` writes over stdio). The
divergence is deliberate and is a property of *this* deployment: upstream's Phase 2 assumes the
LLM client and the data share a machine. Here they never will.

---

## 2. The write-lock

### 2.1 The race, from the code

`frontend/src/store/useStore.js`:

```js
:69   S._ts = Date.now()                                  // every mutation stamps the state
:76   pushTm = setTimeout(() => get().pushState(), 1500)  // debounced, 1.5 s
:152  await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) })
```

`api/server.js`, `PUT /api/data`:

```js
delete body.state.active;
atomicWrite(stateFile(user.id), JSON.stringify(body.state));   // whole state, no version check
```

The write is atomic *as a file operation* and **last-writer-wins as a protocol**. There is no
`If-Match`, no revision, no merge.

And the client will not necessarily take the server's copy back. `useStore.js:49`:

```js
if (!remote || (hasData(local) && (dirty || (remote._ts || 0) < (local._ts || 0)))) return null
```

A client whose local state is dirty, or merely newer, **keeps its own** and pushes it.

Three failure modes follow:

| # | Scenario | Result |
|---|---|---|
| 1 | App open (even idle) with a copy loaded before the import; import writes; app's next debounce fires | **The import is silently erased.** Worst case, because nothing anywhere reports it. |
| 2 | Two imports overlap | Both read, both write; the second wins entirely. One import silently lost. |
| 3 | Import lands mid-workout; app pushes the session | The import is lost, the logged sets survive. Bad, but the *valuable* data wins. |

`importPlan` already sets `state._ts = Date.now()`, so a client that pulls *cleanly* after an
import adopts it. That covers the cold-start case and nothing else.

### 2.2 Proposed mechanism — three layers, cheapest first

**Layer 1 — optimistic concurrency (`expected_ts`). Solves #1 and #2.**

The endpoint gains an optional `expected_ts` field:

* `GET`-equivalent: a `dry_run` response gains `state_ts` (the `_ts` currently on disk, or `null`
  for a profile that has never synced).
* The caller sends that value back on the real run.
* The server re-reads `state-<uid>.json`, compares `_ts`, and on a mismatch answers
  **`409 Conflict`** with `{ error, expected_ts, actual_ts }` instead of writing.

This is the load-bearing layer. It is ~15 lines, needs no lock file and no new state, and it
converts a silent loss into a refusal the caller can act on: *re-run the dry-run, look at what
changed, decide.* Omitting `expected_ts` keeps today's behaviour, so nothing already working
breaks.

**Layer 2 — an advisory lock file. Solves the rest of #2.**

`DATA_DIR/state-<uid>.import.lock`, created with `O_EXCL` (the same "the filesystem is the atomic
primitive" family as `atomicWrite`), holding `{ pid, started, ttl }`. Held only for the duration
of one import — read, transform, write, unlink. A lock older than its TTL (60 s is generous; a
real import takes ~50 ms) is stolen, so a crashed process cannot wedge the endpoint forever.
A caller that finds it held gets **`409`** with `Retry-After`.

This only serialises imports **against each other**. It cannot lock out the browser, which does
not take the lock and cannot be asked to.

**Layer 3 — refuse while a workout is on screen. Solves #3.**

`api/server.js` already keeps a presence map fed by `POST /api/activity`:

```js
const presence = new Map();     // uid -> { name, exIdx, exTotal, setsDone, setsTotal, … }
const PRESENCE_TTL = 70000;     // ~3.5× the 20 s client heartbeat
function livePresence(uid) { … }
```

If `livePresence(uid)` is non-null, the import answers **`423 Locked`** — *"a workout is in
progress on this profile; sets logged in the app would be lost"* — unless the caller passes
`force: true`. Zero new infrastructure; the signal already exists and is already exposed to the
admin dashboard.

### 2.3 What this does NOT solve, stated plainly

**An app that is open but idle does not heartbeat.** `/api/activity` is sent *while a workout is
on screen*, not while the app merely sits on the Home tab. So layer 3 is blind to the single most
likely version of failure #1: the phone in a pocket with the app backgrounded, which will
`pushState()` on the next `visibilitychange`.

Layer 1 catches it **if** that client had already pushed (its `_ts` is on the server, the import
sends it back, and a later push from a *newer* local state is the client's own decision, not a
race). It does **not** catch a client sitting on unpushed changes made before the import.

So the operational rule survives the design and must stay in the docs:

> **Import with the app closed, or pull-to-refresh in the app immediately afterwards.**

**A fourth layer would actually close it**, and the infrastructure is already there: after a
successful import, send a Web Push to the profile's subscriptions telling the app to `pullState()`
and drop its local copy. `web-push`, VAPID keys and the subscription table all exist
(`api/server.js`, `db.subs`). It needs a service-worker message and a store action on the client —
a real frontend divergence from upstream, which is why it is named here as a future step and not
folded into the three layers above.

### 2.4 Summary of the proposed status codes

| Code | Meaning | Caller's next move |
|---|---|---|
| `409` + `expected_ts`/`actual_ts` | the state moved under you | re-run `dry_run`, re-read, decide |
| `409` + `Retry-After` | another import holds the lock | wait and retry |
| `423` | a workout is live on this profile | wait, or `force: true` |

---

## 3. The contract an LLM needs

The point is that a generated plan either **imports cleanly** or **comes back with a question the
LLM can answer on its own**. A human should only be involved in the training decisions.

### 3.1 The minimum valid payload

Everything in [`docs/IMPORT_API.md`](IMPORT_API.md) §3 is optional except this:

```jsonc
{
  "phases": [{
    "name": "…",                         // required — becomes the routine-name prefix + upsert key
    "days": [{
      "name": "…",                       // required — the other half of the upsert key
      "repeat_days": ["Lunes"],          // optional, but without it the day is never scheduled
      "exercises": [{
        "name": "…",                     // required (or "exercise_id")
        "sets": 4                        // defaults to 1
        // reps / timed_s / duration_min — one of the three, or it defaults to 10 reps + a warning
      }]
    }]
  }]
}
```

Everything else has a defined default. The three fields worth insisting on in a tool description,
because their absence is silent rather than loud:

* **`timed_s` for anything held.** Without it a 45-second plank is logged as 45 repetitions.
  This is the single highest-cost mistake an LLM can make here.
* **`start_date`** (the Monday of plan week 1) — without it, deload routines are created but
  never land on the calendar. The import warns; the warning is easy to skim past.
* **`repeat_days`** — a day with no weekday is created and never scheduled.

### 3.2 Unresolved exercise names: is "always create a custom" acceptable?

**No, not unconditionally**, and the current behaviour should stay the default only because it is
the safe one for a *human-reviewed* import.

What happens today: a name that resolves against neither the catalogue nor the Spanish alias table
becomes a `customEx` with an inferred body part, the import continues, and the response lists it.
For the real 24-week plan that produced 8 customs out of 68 exercises — and all 8 were genuinely
absent from the dataset (chin tucks, wall angels, doorway pec stretch, both planks, three cardio
blocks). That is the mechanism working.

The failure mode is different: an LLM that hallucinates *plausible but wrong* names — "Cable
Hammer Preacher Curl", "Smith Machine Romanian Split Squat" — gets **silent success**. Twelve
custom exercises with no images, no muscle data, and no 1RM history, and a response that says
`"ok": true`.

Proposal: **`max_custom_exercises`**, an optional integer.

* Absent → today's behaviour, unlimited. Nothing that works stops working.
* Set (recommended: **5** for an LLM-generated plan) → if the import would create more than that,
  it writes **nothing** and answers `422` with the full list plus suggestions:

```jsonc
{
  "error": "8 exercises would be created as custom, over the limit of 5",
  "needs_confirmation": [
    {
      "name": "Cable Hammer Preacher Curl",
      "inferred_body_part": "upper arms",
      "did_you_mean": [
        { "id": "0313", "name": "dumbbell hammer curl",  "score": 340 },
        { "id": "0592", "name": "lever preacher curl",   "score": 300 }
      ]
    }
  ],
  "confirm_with": "Re-send with exercise_id set on the ones you meant, or raise max_custom_exercises."
}
```

`did_you_mean` is not new code in spirit: `frontend/src/lib/exercises.js` already exports
`searchScore(exercise, query)`, a ranked fuzzy score built exactly for this ("0 means no match, so
`matchesExerciseSearch` stays a boolean filter while the picker can rank results by score"). The
importer currently throws that ranking away by using only `matchExercise()`, which is deliberately
all-or-nothing — *"guessing between 'barbell bench press' and 'dumbbell bench press' would file
years of training under the wrong lift"*. Keeping the strict matcher for the decision and using
the ranked one for the **suggestion** is the right split: the server never guesses, the LLM gets
enough to choose.

### 3.3 The iteration loop

Two phases, both of which the endpoint already has half of:

```
1.  POST …/import-plan?dry_run=1     →  200 { state_ts, counts, exercises{…}, warnings[] }
       │                                  or 422 { needs_confirmation[…] }
       ▼
2.  LLM reads the summary. Fixes what it can on its own (sets exercise_id from did_you_mean,
    adds a missing timed_s, adds start_date). Asks the human only about training decisions.
       ▼
3.  POST …/import-plan  { …, "expected_ts": <state_ts from step 1> }   →  200
       │                                  or 409 (state moved) / 423 (workout live)
       ▼
4.  LLM renders the response as prose. The human never sees JSON.
```

The response fields that make step 4 possible already exist: `counts`, `routines.created/updated`,
`exercises.matched[].via`, `exercises.custom_created[]`, `week` (weekday → routine name),
`day_overrides`, `warnings[]`. `scripts/import-plan.mjs` already turns exactly those into a human
summary — that function is the reference for what the LLM should say.

### 3.4 What a tool description has to carry

Beyond the OpenAPI schema, the tool's prose needs the four things the schema cannot express:

1. `timed_s` is what distinguishes a hold from repetitions.
2. openGym has no phases and no plan weeks; `active_phase` is the only one that gets scheduled,
   and one weekday holds exactly one routine.
3. Double progression advances after **one** qualifying session, not two — do not promise a rule
   the app will not follow.
4. Always `dry_run` first, and read `warnings` — a `200` with eight warnings is not a success.

---

## 4. End-to-end, as it would actually go

> No code exists for this yet. This is the target, written out so the design can be judged
> against it.

**You:** *"Quiero un plan de fuerza de 4 días, prioriza pierna. Empiezo el lunes que viene."*

**The LLM** has one tool, `opengym_import_plan`, from `api/openapi.yaml`. It writes a payload in
the `docs/IMPORT_API.md` format: two leg days, two upper days, `progression_default:
"double_progression"`, `start_date: "2026-09-07"`, `active_phase` set to the only phase, rep
ranges rather than flat targets, `timed_s` on the carries and planks.

**Call 1 — dry run.**

```http
POST /api/admin/import-plan?dry_run=1
X-Import-Key: ••••
```

```jsonc
{ "ok": true, "dry_run": true, "state_ts": 1788349280759,
  "counts": { "routines_created": 4, "exercises_matched": 26, "exercises_custom_created": 2 },
  "exercises": { "custom_created": [
      { "name": "Copenhagen Plank", "body_part": "waist" },
      { "name": "Cable Hammer Preacher Curl", "body_part": "upper arms" } ] },
  "warnings": ["\"Pierna A\": 5 exercise(s) had a single rep target under double progression — filled the range in as 8-10"] }
```

**The LLM fixes what it can.** A Copenhagen plank genuinely is not in the dataset — a custom is
correct. "Cable Hammer Preacher Curl" is its own invention; `did_you_mean` offers
`0313 dumbbell hammer curl`, so it sets `exercise_id: "0313"` and stops inventing. It does not ask
you about either.

**Call 2 — the real one**, carrying `expected_ts: 1788349280759`. The state has not moved, no
workout is live, so it writes, backs the old state up, and returns the summary.

**The LLM answers you in prose:**

> Listo. Cuatro rutinas nuevas en tu plan, empezando el lunes 7:
>
> - **Lunes — F1 · Pierna A** · 6 ejercicios, sentadilla en Smith 4×8-10, prensa 4×10-12
> - **Martes — F1 · Torso A** · 6 ejercicios
> - **Jueves — F1 · Pierna B** · 6 ejercicios, peso muerto rumano 4×8-10
> - **Viernes — F1 · Torso B** · 5 ejercicios
>
> 26 ejercicios salieron del catálogo. Creé **Copenhagen Plank** como ejercicio propio (no está
> en el dataset) — no tendrá imagen ni mapa muscular. Puse rangos de repeticiones en los que
> venían con un número suelto, porque la doble progresión los necesita.
>
> Copia de seguridad del plan anterior: `state-abc123.json.bak-2026-09-02T12-04-11-902Z`.

You never see JSON. You never see the word `timed_s`.

---

## 5. What to build, in order

| # | Step | Size | Unblocks | Status |
|---|---|---|---|---|
| 1 | Add the endpoint to `api/openapi.yaml` + an `importKey` security scheme | small | **any** function-calling LLM. Also closes the gap the spec's own header calls out. | **done** |
| 2 | `expected_ts` + `409` | small | writing safely while the app exists | **done** |
| 3 | `state_ts` in the response | trivial | step 2 has something to send | **done** |
| 4 | `max_custom_exercises` + `did_you_mean` (via the existing `searchScore`) | medium | the LLM iterating without a human | *pending, §6* |
| 5 | `423` on live presence | small | not clobbering a session in progress | *pending, §6* |
| 6 | Import lock file | small | concurrent imports | *pending, §6* |
| 7 | MCP `import_plan` tool as an HTTP client of the endpoint, opt-in on a key | medium | Claude Desktop / Cursor, same write path | *pending* |
| 8 | Push-triggered `pullState()` after an import | large (frontend) | the "app open and idle" hole in §2.3 | *pending* |

Steps 1–3 are the ones that turn "an endpoint a script can call" into "an endpoint an LLM can be
trusted with". Everything after that is hardening.

---

## 6. Pendiente — no implementado en esta sesión

Deliberately deferred until steps 1–3 have been exercised against a real profile. Written down
here so it is not confused with what shipped, and not quietly lost.

### 6.1 Import lock file (§2.2 layer 2) — **not implemented**

`DATA_DIR/state-<uid>.import.lock`, `O_EXCL`, 60 s TTL, `409` + `Retry-After` when held.

Why deferred: it only serialises **imports against each other**, and today there is exactly one
caller — a script run by hand. `expected_ts` already turns two overlapping imports into a
detectable conflict for any caller that sends it. The lock becomes worth its complexity the day
an LLM can fire the endpoint on its own schedule.

### 6.2 `423` on live presence (§2.2 layer 3) — **not implemented**

Refuse while `livePresence(uid)` is non-null, unless `force: true`.

Why deferred: it needs the `presence` map to actually have something in it, which means a real
profile with a workout genuinely on screen. There was no profile on the instance when this was
written (see the handoff), so the feature could have been coded but not honestly tested. Shipping
a concurrency guard that has never once fired is how you get a concurrency guard that does not
work.

### 6.3 `max_custom_exercises` + `did_you_mean` (§3.2) — **not implemented**

`422` with ranked suggestions from the existing `searchScore` when a payload would invent more
than N custom exercises.

Why deferred: it changes the endpoint from "always writes what you sent" to "sometimes refuses on
a judgement call", and the threshold is a product decision, not a technical one — the real plan
legitimately produced 8 customs out of 68 exercises, which any sane default would have blocked.
It is worth building the moment an LLM is generating payloads unsupervised; it is a nuisance while
a human is still writing them.

**Note on `api/openapi.yaml`:** none of the above is documented there as a response the endpoint
can return, precisely because it cannot. The spec's own header calls itself the mirror of
`api/server.js`; documenting a `422` or a `423` that never arrives would break that promise. They
go in when they ship.

### 6.4 Nothing in `mcp/` was touched

No file under `mcp/` was read for modification, changed, or duplicated in this work. Its
read-only tools remain the only path for "ask an LLM about my training"; the HTTP endpoint gained
no read surface of its own and still answers only about the import it just performed. Step 7 of
§5, if it is ever built, is explicitly a **client** of the HTTP endpoint rather than a second
writer over `./data` — see §1.3.
