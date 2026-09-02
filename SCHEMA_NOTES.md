# SCHEMA_NOTES.md — investigación previa a `POST /api/admin/import-plan`

Estado: **implementado.** El endpoint, los tests, la documentación y el despliegue existen.
Este documento es la investigación que los precedió, más (§9, §10) lo que se hizo realmente.
Fecha: 2026-09-02. Autor: Claude Code, sobre el fork `aalbaladejocortes/openGym`.

---

## 0. Resumen de decisiones que hay que tomar antes de implementar

| # | Hallazgo | Impacto |
|---|---|---|
| 0.1 | El fork está **296 commits / 10 releases por detrás** del remoto real (GitLab). | Bloqueante: hay que decidir si sincronizar antes de implementar. |
| 0.2 | El fork **no tiene ni una sola modificación propia** (`api/server.js` es byte-idéntico a `v1.2.4`). | Sincronizar es trivial: cero conflictos. |
| 0.3 | Upstream ya trae `plan-share.js` con un **formato de fichero de plan y su importador** (`parsePlan` / `mergePlan`). | El endpoint debe reutilizarlo, no inventar formato. |
| 0.4 | Upstream ya trae `matchExercise(name)` (matching difuso nombre → id de catálogo). | El punto 2.1 del encargo (fuzzy match) ya existe. |
| 0.5 | openGym **no tiene concepto de fases, semanas ni descargas**. | Hay que mapear el plan de 24 semanas a rutinas planas + un flag. |
| 0.6 | El puerto host `8080` (default de `WEB_PORT`) **ya está ocupado** por `ktor-huertando`. | openGym irá a otro puerto. |

---

## 1. Estado del fork vs. el remoto real

* Fork (`github.com/aalbaladejocortes/openGym`): 5 commits (`asd`, `asd`, `Create render.yaml`, `commit`, `Initial commit`), sin tags. `CHANGELOG.md` termina en **v1.2.4 — 2026-08-01**.
* Upstream real (`gitlab.com/DuarteSantos8/opengym`): último tag **v1.2.14 — 2026-08-30**, más 15 commits sin taggear encima.
* `git rev-list --count v1.2.4..HEAD` sobre upstream = **296 commits**.
* `git diff --stat v1.2.4 HEAD` = **232 ficheros, +50 029 / −1 227**.
* Comprobación de deriva propia: `diff api/server.js <(git show v1.2.4:api/server.js)` → **idéntico**. El fork es una copia limpia de v1.2.4 con un `render.yaml` y un `.DS_Store` encima.

Lo que trae el upstream y **falta** en el fork, relevante para este encargo:

* `mcp/` — el servidor MCP (v1.2.5).
* `docs/API.md` + `website/api.html` — spec OpenAPI 3.1 escrita a mano de **todas** las rutas, incluidas `/api/admin/*`.
* `docs/DATA_IMPORTS.md` — documentación de los importadores existentes.
* `frontend/src/lib/import-hevy.js`, `hevy-id-map.js` — import desde la API de Hevy.
* `frontend/src/lib/rep-range.js` — `repsMin`/`reps` normalizados (la doble progresión).
* `frontend/src/lib/workout-model.js`, `finish-workout.js`, `backfill.js`, `equipment.js`, `bar.js`, `audit.js`, `guest.js`, `progression-copy.js`.
* `.env.example` en la raíz (**el fork no lo tiene**; el encargo pide actualizarlo).
* `web/nginx.conf.template` (sustituye a `web/nginx.conf`), `renovate.json`, `package.json` raíz.

---

## 2. `data/` — qué hay en disco

`DATA_DIR` = `/data` dentro del contenedor `api`, montado desde `./data`.

```
data/
  db.json                # { users[], creds[], subs[], invites[] } — perfiles + claves públicas de passkey
  secret                 # clave HMAC de sesión (cookie)
  vapid.json             # par de claves VAPID para Web Push
  state-<uid>.json       # TODO el entrenamiento de un usuario, un fichero por perfil
```

`api/server.js:59`:
```js
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
```
El `uid` se sanea a `[a-zA-Z0-9_-]`. El endpoint nuevo debe usar **esta misma función**, no construir la ruta a mano.

El servidor **no valida ni entiende** el contenido de `state-<uid>.json`. `PUT /api/data` sólo hace:
```js
delete body.state.active;              // los entrenos en curso se quedan en el dispositivo
atomicWrite(stateFile(user.id), JSON.stringify(body.state));
```
Es decir: **el esquema vive entero en el frontend**. El endpoint de importación tiene que replicar la forma que espera React, porque nadie más la va a validar.

---

## 3. Estructura exacta de `state-<uid>.json`

Fuente autoritativa: `mcp/src/state.js` → `defaultsShape()` (es la misma forma que el frontend construye al hacer `pullState`).

```js
{
  unit: 'kg',            // 'kg' | 'lb'
  restSec: 90,           // descanso por defecto, segundos
  sound: true,
  lang: 'en',            // 'es' para mí
  theme: 'dark', accent: 'lime', body: 'male',
  targetW: null,         // peso objetivo
  bodyweight: [],        // [{ d: '2026-09-02', w: 78.3, t: 1756800000000 }]
  routines: [],          // ← el plan: ver §4
  week: {},              // { '<getDay()>': '<routineId>' } — 0=domingo … 6=sábado
  dayPlan: {},           // { '2026-09-02': '<routineId>' | 'rest' } — override por fecha concreta
  exWeights: {},         // { '<exId>': <último peso usado> }
  workouts: [],          // historial de sesiones
  customEx: [],          // ejercicios propios del usuario: [{ id, n, bp, desc? }]
  gifSize: 'full',       // 'full' | 'small' | 'off'
  reminder: { on: false, time: '08:00', tz: null }
}
```

Campos adicionales que aparecen en estado real y **no** están en `defaultsShape()` (no romper al reescribir): `_ts` (timestamp de sync, lo devuelve `PUT /api/data`), `active` (entreno en curso — el servidor lo borra siempre).

### Resolución de "qué toca hoy" (`history.js:276`)

```js
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return null
  if (ov && S.routines.some(r => r.id === ov)) return ov
  const wd = new Date(iso + 'T12:00:00').getDay()
  return S.week[wd] || null
}
```

**Consecuencia dura: un día del calendario admite exactamente una rutina.** No hay "rutina principal + rutina de movilidad" el mismo día. Esto decide el §8.3.

---

## 4. Una rutina (`S.routines[]`)

Forma mínima, de `starter.js`:
```js
{ id: uid(), name: 'Push Day', emoji: 'barbell', ex: [ { id: '0025', sets: 4, reps: 8, weight: 0 }, … ] }
```

Campos de rutina que el resto del código lee:

| Campo | Tipo | Significado |
|---|---|---|
| `id` | string | id generado con `uid()` de `format.js` |
| `name` | string | nombre visible |
| `emoji` | string | clave de glifo (`glyphs.js`), p.ej. `'barbell'`, `'pullup'`, `'legs'` |
| `ex` | array | ejercicios, **en orden** |
| `prog` | string | política de progresión por defecto de la rutina (§5) |
| `excludeFromProgression` | bool | **la descarga nativa**: una sesión de esta rutina no cuenta como "la última vez" para progresar, y usa el peso escrito en la rutina en vez de arrastrar el de la sesión anterior (`history.js:332-369`) |

### Un ejercicio dentro de `ex[]`

Sacado de `cleanEx()` en `plan-share.js` — es la lista canónica de campos que "viajan" con un plan:

| Campo | Tipo | Significado |
|---|---|---|
| `id` | string | id del catálogo (`'0025'`) o de un `customEx` |
| `sets` | number | series |
| `reps` | number | reps objetivo. En doble progresión es el **techo** del rango |
| `repsMin` | number | suelo del rango (doble progresión). `rep-range.js` normaliza el par |
| `repsMax` | number | también viaja en el fichero de plan; `normalizeRepRange(reps, repsMin)` es el que manda |
| `weight` | number | peso objetivo. `0` = sin peso |
| `mode` | `'reps'`\|`'time'`\|`'cardio'` | **se escribe explícito sólo para `'time'`**; si falta, `modeOf()` devuelve `'cardio'` si el ejercicio es de bp `cardio`, si no `'reps'` |
| `sec` | number | segundos de la serie, sólo en `mode: 'time'` |
| `min`, `speed` | number | minutos y km/h, sólo `mode: 'cardio'` |
| `bodyweight` | bool | sólo se escribe **cuando discrepa** de `isBodyweightEq(id)`. Si es `true`, `weight` significa peso *añadido* |
| `side` | bool | reps por lado. Sólo válido en `mode: 'reps'` (`isPerSide`) |
| `prog` | string | override de progresión de **este** ejercicio (§5) |
| `inc` | number | incremento de carga propio, sobrescribe `defaultIncrement()` |
| `restSec` | number | descanso propio del ejercicio; si falta, manda `S.restSec` |
| `sg` | string | **superserie**: clave de grupo compartida. `history.js:151` borra un `sg` que no tenga vecino inmediato con el mismo `sg` → los miembros de una superserie deben ser **contiguos en `ex[]`** |
| `note` | string | nota libre por ejercicio |
| `warmupSets` | number | series de calentamiento planificadas (tope `MAX_PLANNED_WARMUPS`) |
| `intensifier` | object | drop-sets / rest-pause |

`modeOf()` (`history.js`):
```js
export function modeOf(cfg) {
  const m = cfg && cfg.mode
  if (m === 'reps' || m === 'time' || m === 'cardio') return m
  return isCardio(cfg && cfg.id) ? 'cardio' : 'reps'
}
```
→ **una plancha se marca con `mode: 'time'` + `sec`**. Sin `mode`, 45 segundos se convierten en 45 repeticiones.

---

## 5. Reglas de progresión (`frontend/src/lib/progression.js`)

```js
export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time']

export const POLICIES_FOR = {
  reps:   ['off', 'linear', 'greyskull', 'double'],
  time:   ['off', 'time'],
  cardio: ['off']
}
```

Resolución de qué política aplica (`policyFor`):
```
cfg.prog  →  routine.prog  →  (mode === 'reps' ? 'linear' : 'off')
```
…y si la política elegida no está en `POLICIES_FOR[mode]`, cae a `'off'`.

Significado (`POLICY_DESC`, literal):
* `linear` — "Hit every rep in every set and the weight goes up. Repeated misses trigger a deload."
* `greyskull` — "Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %."
* `double` — "Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom." ← **la que quiero**
* `time` — "Hold every set for the full duration and the target goes up."

Otros números fijos:
```js
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, time: 3 }
const DELOAD_FACTOR = 0.9
export const DEFAULT_SEC_INCREMENT = 5
export const MAX_BW_SETS = 6
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']
// defaultIncrement: kg → 5 si heavy, 2.5 si no | lb → 10 si heavy, 5 si no
```

Todo se **deriva del historial en cada lectura**; no hay contadores guardados. Consecuencia para el import: escribir la rutina con `prog`, `reps`, `repsMin`, `weight` e `inc` es *todo* lo que hay que persistir. Nada de estado de progresión.

Nota sobre mi doble progresión ("al tocar el techo del rango en **todas** las series durante **2 sesiones seguidas**, subir peso"): `double` de openGym sube al tocar el techo en todas las series en **una** sesión, no dos. No es configurable. Es la diferencia más cercana; se documentará en `docs/IMPORT_API.md` en vez de forzar una política nueva.

---

## 6. Ejercicios: catálogo, matching y custom

### Catálogo
* `frontend/src/lib/exercises-data.js` → `EXDB` (~1300 ejercicios del dataset `hasaneyldrm/exercises-dataset`, CC).
* `exercises.js` construye `CATALOGUE` (EXDB + overlay de músculos revisado) y `EXIDX` (índice por id).
* Campos por ejercicio: `id` (string de 4 dígitos, `'0025'`), `n` (nombre en inglés), `bp` (body part), `tg` (target), `eq` (equipment), `sm[]` (secundarios), `img`, `gif`.
* Los **nombres en español no están en el dataset**: viven en la capa i18n (`i18n-core.js` → `exerciseNameFor` / `exerciseNameSearchText`). El dataset es sólo inglés.
* Las imágenes/GIFs no van en el repo: el servicio `media` del compose los clona a `./media/{img,gif}` (~140 MB, una vez).

### Matching por nombre — **ya existe**
`import-csv.js:230`:
```js
export function matchExercise(name) { … }
```
Orden: alias curado (`ALIAS_EX`, comparado como bolsa de palabras ordenada) → match exacto de bolsa de palabras → candidatos que contienen todas las palabras de la query, **sólo si hay exactamente uno** a esa distancia (`extra <= 2`). Si hay empate devuelve `null` a propósito:

> "Guessing between 'barbell bench press' and 'dumbbell bench press' would file years of training under the wrong lift, which is worse than leaving it as a custom exercise the user can see and fix."

Herramientas complementarias en `exercises.js`:
```js
export const normalizeStr = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function matchExercise(e, query)   // ojo: mismo nombre, otra cosa — filtro del buscador
export function searchScore(exercise, query)   // ranking difuso, 0 = no match
```
`normalizeStr` es exactamente el "sin tildes, case-insensitive" que pide el encargo. Lo que **no** hay es el stripping de `"(postural)"` y notas entre paréntesis: eso sí es código nuevo (una línea, `.replace(/\([^)]*\)/g, ' ')` antes de llamar a `matchExercise`).

Faltará también una capa **es→en** para los nombres de mi plan, porque `matchExercise` indexa el catálogo en inglés. Opciones: (a) usar `exerciseNameFor` de i18n para construir un índice en español, (b) tabla de alias propia en el payload/servidor. Se decide al implementar.

### Ejercicios propios (`S.customEx`)
```js
{ id: uid(), n: '<nombre>', bp: '<body part>', desc?: '<texto>' }
```
`registerCustom(list)` los mete en `EXIDX`, así que **cualquier `EXIDX[id]` sigue funcionando**. `allExercises(st)` los pone primero en el buscador. Un id que no resuelve no rompe la vista: `exOr(id)` devuelve un placeholder `{ missing: true }`.

Para los ejercicios de mi plan que no matcheen (chin tucks, wall angels, estiramiento en marco de puerta…), la ruta correcta es **crear `customEx`**, tal y como pide el encargo. `bp` debe salir del vocabulario del catálogo (`BODYPARTS`).

---

## 7. Lo que ya existe y NO hay que reinventar

### 7.1 Formato de fichero de plan (`plan-share.js`) — **esto es el formato de import**

`buildPlanBundle(S, name)` produce, y `parsePlan(raw)` consume:
```jsonc
{
  "opengym_plan": 1,          // PLAN_FMT — parsePlan rechaza el fichero si falta
  "name": "…",
  "routines": [ { "id", "name", "emoji", "prog?", "excludeFromProgression?", "ex": [ …cleanEx… ] } ],
  "week": { "1": "<routineId>", … },
  "customEx": [ { "id", "n", "bp", "desc?" } ]
}
```
`mergePlan(s, bundle, { schedule })`:
* customs: reutiliza uno existente con **mismo nombre (case-insensitive) + mismo `bp`**, si no lo añade con id nuevo;
* rutinas: **siempre las añade como nuevas** (ids frescos) — nunca sobrescribe;
* `schedule: true`: la semana compartida **reemplaza** la tuya entera.

→ `mergePlan` **no es idempotente**: importar dos veces duplica rutinas. El requisito 2.4 del encargo (idempotencia por nombre de fase/día) es la única divergencia real respecto a lo existente. La implementación correcta es una `mergePlanIdempotent` en el servidor que haga upsert por `name`, reutilizando `parsePlan` y `cleanEx` para todo lo demás.

### 7.2 Servidor MCP (`mcp/`) — sólo lectura, no lo dupliques

* Proceso **stdio** que lanza el cliente LLM (Claude Desktop, Cursor). No es un contenedor, no abre red, no añade dependencias al runtime de openGym.
* Lee `./data/db.json` y `./data/state-<uid>.json` directamente del disco. Config por env: `OPENGYM_DATA`, `OPENGYM_UID` (autodetecta si sólo hay un perfil).
* Cachea el estado por `mtime` y lo re-lee con un `fs.watch`; expone `_seedStateForTests(state)` para tests.
* Importa las libs puras del frontend como ESM de Node (`history.js`, `onerm.js`, `muscles.js`, `exercises.js`) para que los números coincidan con la pantalla de Stats.
* 8 herramientas de lectura: `list_routines`, `get_routine`, `get_week_plan`, `list_workouts`, `get_workout`, `get_bodyweight`, `estimate_1rm`, `muscle_balance`.
* Roadmap declarado: la **Fase 2 es exactamente lectura+escritura** (`log_workout`, `edit_routine`, `assign_weekday`…), y dice que requiere "long-lived token auth minted from the admin dashboard (new `./data/tokens.json`) and a **write-lock** against the web UI's read-modify-write of `state-<uid>.json`".

**Patrón a copiar en el endpoint de escritura:** acceso directo a `./data` vía las mismas rutas (`stateFile(uid)`), reutilización de las libs puras del frontend importadas como ESM en vez de reimplementar reglas, y cero dependencias nuevas. El aviso del write-lock también aplica: si el navegador tiene la app abierta, su `PUT /api/data` puede pisar lo que escriba el import. Se documentará como limitación operativa (importar con la app cerrada) en vez de montar un lock a medias.

### 7.3 Rutas `/api/admin/*` que ya existen
`GET /api/admin/users`, `GET /api/admin/user`, `POST /api/admin/user/disable`, `GET /api/admin/invites`, `POST /api/admin/invites/new`, `POST /api/admin/invites/revoke`, `GET /api/admin/audit`, `POST /api/admin/audit/clear`.

Todas pasan por `requireAdmin(req, res)` (`server.js:304`), que resuelve **sesión de navegador** y exige `user.admin === true || ADMIN_UIDS.includes(user.id)`. Registra `admin.denied` en el audit log en el 403.

→ `POST /api/admin/import-plan` **no puede usar `requireAdmin`**: es autenticación por cabecera de servicio (`X-Import-Key`), no por sesión. Va como un guard aparte, delante de `requireAdmin`. Hay que revisar además:
* el **guard CSRF por Origin** (`server.js:329-358`): las peticiones que cambian estado exigen `Origin === ORIGIN`, con una lista de exenciones. Una llamada de `curl`/script no manda `Origin` — hay que confirmar si el guard exime peticiones sin `Origin` o si el endpoint nuevo necesita entrar en la lista de exenciones.
* el **audit log** existente (`audit()`, un objeto JSON por línea) — es el sitio natural donde registrar un import, y donde NO debe aparecer nunca la `IMPORT_API_KEY`.

---

## 8. Cómo mapea mi plan de 6 meses al esquema real

### 8.1 Fases → no existen
openGym no tiene mesociclos, ni bloques, ni "semana N del plan". `grep -ril "mesocycle|phase"` sobre `frontend/src/lib` y `frontend/src/pages` no devuelve nada funcional.

Mapeo propuesto: **una rutina por (fase × día)**, con el nombre llevando la fase:
```
"F1 · Full Body"          (fase 1, semanas 1-8)
"F2 · Torso A" … "F2 · Pierna B"   (fase 2, semanas 9-16)
"F3 · Push" / "F3 · Pull" / "F3 · Legs"  (fase 3, semanas 17-24)
```
`S.week` sólo puede reflejar **una fase a la vez** (7 días, una rutina por día). Las 12 rutinas se crean todas; `week` se rellena con la fase activa. Cambiar de fase = reasignar `week`. El endpoint aceptará un campo para decir qué fase programar (`active_phase`), y por defecto programará la primera.

Esto es también la clave de idempotencia: **el nombre de la rutina (`"F2 · Torso A"`) es la clave de upsert**.

### 8.2 Semanas de descarga → `excludeFromProgression`
Existe soporte nativo, pero por **rutina**, no por semana del calendario. openGym no sabe que la semana 4 es descarga.

Dos opciones:
* (a) generar rutinas gemelas `"F1 · Full Body (descarga)"` con `excludeFromProgression: true` y `sets` reducidos un 40 % (redondeo hacia abajo, mismo `weight`), y asignarlas a mano vía `dayPlan` en las semanas 4/8/12/16/20/24;
* (b) no generarlas y anotar la descarga en la `note` de la rutina.

Recomiendo **(a)**: es el mecanismo que la app tiene para exactamente esto, y `dayPlan` (override por fecha ISO) permite programarlas sin tocar `week`. Coste: duplica el número de rutinas (12 → 24). Se puede hacer opcional con un flag del payload (`emit_deload_routines: true`).

### 8.3 Rutina postural diaria → **no cabe como capa**
`effectiveRoutineId` devuelve **una** rutina por día. No hay forma de decir "hoy Torso A + los 3 posturales". Y openGym no tiene "día de descanso con ejercicios ligeros": un día sin rutina es descanso, punto (`dayPlan[iso] === 'rest'` o `week[wd]` vacío).

Decisión: **híbrido**.
1. Los 3 ejercicios posturales se **anexan al final de `ex[]` de cada rutina de entrenamiento**, con `note: 'postural'`, para que se hagan los días que entreno.
2. Se crea además una rutina `"Postural diario"` con esos 3 ejercicios, y se asigna en `week` a los días que quedarían de descanso, para que también estén los días que no entreno.

Los tres son `customEx` casi seguro (chin tucks, wall angels, estiramiento en marco de puerta) y dos de ellos son `mode: 'time'` (el estiramiento) o reps con hold.

### 8.4 Etiqueta "bloque postural"
No existe un sistema de tags en el esquema de ejercicio. Los campos disponibles son `note` (string libre) y `sg` (grupo de superserie — **no** usar para esto, cambia el comportamiento de la app). Face pull y contractor inverso llevarán `note: 'postural'`. El mapa muscular no lee `note`, así que esto es documental, tal y como contempla el encargo ("si no lo soporta, que quede al menos como nota").

### 8.5 Cardio
`bp === 'cardio'` → `mode: 'cardio'`, campos `min` y `speed`, y `POLICIES_FOR.cardio === ['off']`. Los bloques de cardio de mi plan (caminata, intervalos, HIIT) se pueden emitir como rutinas propias asignadas a sus días, o dejarse fuera del import. Es una decisión de payload, no de esquema.

### 8.6 Superserie (fase 2: curl bíceps + extensión tríceps)
`sg: '<clave>'` compartida, y los dos ejercicios **contiguos** en `ex[]`. Si no son contiguos, `history.js:151` borra el `sg` silenciosamente.

### 8.7 Pesos iniciales con rango ("20-30", "10-15 por lado")
`weight` es un número. Un rango no cabe. Se tomará el **extremo inferior** como `weight` y el texto original irá a `note`. "por lado" **no** es `side` (`side` cuenta *repeticiones* por lado, no carga): también va a `note`.

---

## 9. Convenciones de la VPS (para el despliegue)

*Reconocimiento previo; §10 recoge lo que finalmente se ejecutó.*

* **Ubicación**: cada servicio en `/home/ubuntu/<nombre>/` con su propio compose. openGym → `/home/ubuntu/opengym` ✓ (ya clonado ahí).
* **Compose**: `docker-compose.yml` (n8n usa `compose.yaml`; la mayoría usa `docker-compose.yml`). `name:` de proyecto explícito, `restart: always` o `unless-stopped`, `.env` al lado, sin `version:`.
* **Publicación de puertos**: los servicios web van **atados a loopback** — `"127.0.0.1:5678:5678"` (n8n), `"127.0.0.1:${OPEN_DESIGN_PORT:-7456}:7456"` (open-design). El `docker-compose.yml` de openGym publica `"${WEB_PORT:-8080}:80"` (todas las interfaces) → **hay que cambiarlo a `127.0.0.1:`**.
* **Puerto**: `8080` está **ocupado** por `ktor-huertando` (`0.0.0.0:8080->8080`). No se toca. Libres en el rango: 8085, 8086, 8087, 8089, 8090, 8091. Propuesta: **`WEB_PORT=8090`**.
* **nginx**: un fichero por subdominio en `/etc/nginx/sites-available/<fqdn>` + symlink en `sites-enabled`. Patrón exacto (de `n8n.albertoalbaladejo.com`): bloque `:80` con `location /.well-known/acme-challenge/ { root /var/www/html; }` + `return 301 https://$host$request_uri`; bloque `:443 ssl http2` con `ssl_certificate`/`ssl_certificate_key` de `/etc/letsencrypt/live/<fqdn>/`, `include /etc/letsencrypt/options-ssl-nginx.conf`, `ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem`, las 4 cabeceras (`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), `client_max_body_size`, y `proxy_pass http://127.0.0.1:<puerto>` con el bloque completo de `proxy_set_header` + `Upgrade`/`Connection`.
* **Certbot**: manual, certificados en `/etc/letsencrypt/live/`. Hay 20 vhosts ya emitidos con este patrón.
* **Coolify**: corre en `127.0.0.1:8110` (+ un contenedor de app en `0.0.0.0:8300`), con sus propias redes `coolify` y `coolify-net`. Los servicios de `/home/ubuntu/*` **no** están gestionados por Coolify — van por compose manual + nginx. openGym sigue ese camino; **no se toca nada de Coolify**.
* **Redes Docker**: no hay una red compartida común. Cada proyecto crea la suya (`<proyecto>_default`). openGym hará lo mismo → cero colisión.
* **Nombres de contenedor**: `opengym-api-1` / `opengym-web-1` (del `name: opengym` del compose). Ninguno colisiona con los 60 contenedores actuales.
* `RP_ID=gym.albertoalbaladejo.com` y `ORIGIN=https://gym.albertoalbaladejo.com` — `RP_ID` es hostname pelado (sin esquema, sin puerto, sin barra final); `ORIGIN` es el origen completo. Documentado en `docs/SELF_HOSTING.md` §256-268.

---

## 10. Lo que se hizo realmente

### 10.1 Sincronización del fork (decidida contigo antes de tocar código)

`main` reseteado a `upstream-gitlab/main` (`272bf78`, v1.2.14 + 15 commits). Se pudo hacer con
`git reset --hard` y no con merge porque el fork **no tenía ninguna modificación propia**:
`api/server.js` era byte-idéntico a `v1.2.4` del upstream. Rama de seguridad local
`backup/pre-sync-v1.2.4` apuntando al estado anterior; se borraron `.DS_Store` y `render.yaml`
(los dos únicos añadidos del fork).

**Pendiente:** el `gh` de la VPS está autenticado como `albertoalbaladejo`, que sólo tiene
permiso de lectura sobre `aalbaladejocortes/openGym` (`{"push": false}`). El sync está hecho en
local pero **no se ha podido empujar a GitHub**, y por lo mismo el workflow de
`.github/workflows/sync-upstream.yml` está escrito pero no activo.

### 10.2 Despliegue en la VPS

| Qué | Decisión | Por qué |
|---|---|---|
| Carpeta | `/home/ubuntu/opengym` | Misma convención que los otros 14 proyectos con compose bajo `/home/ubuntu/`. |
| Puerto host | **8090**, vía `WEB_PORT=127.0.0.1:8090` en `.env` | 8080 (el default de openGym) lo ocupa `ktor-huertando` en `0.0.0.0:8080`. No se tocó. Poner el bind en la propia variable evita parchear el `docker-compose.yml` versionado y se pierde menos en cada sync con upstream. |
| Exposición | Sólo loopback | Es lo que hacen n8n (`127.0.0.1:5678:5678`) y open-design. El compose de openGym publicaba en todas las interfaces. |
| nginx | `/etc/nginx/sites-available/gym.albertoalbaladejo.com` + symlink | Copia literal del patrón de `n8n.albertoalbaladejo.com`: bloque `:80` con `acme-challenge` + redirect 301, bloque `:443 ssl http2`, las 4 cabeceras de seguridad, `client_max_body_size 50m`, y el bloque completo de `proxy_set_header` con `Upgrade`/`Connection`. |
| Certbot | `certonly --webroot -w /var/www/html --key-type rsa --preferred-chain "ISRG Root X1"` | Exactamente los `renewalparams` de los otros 20 vhosts (`authenticator = webroot`). Renovación automática ya programada por certbot. Caduca 2026-12-01. |
| Coolify | No se tocó | Corre en `127.0.0.1:8110` y `0.0.0.0:8300` con sus redes `coolify`/`coolify-net`. Ningún servicio de `/home/ubuntu/*` está gestionado por él; openGym tampoco. |
| Red Docker | `opengym_default`, propia | No hay red compartida en esta VPS; cada proyecto crea la suya. Contenedores `opengym-api-1` / `opengym-web-1`, sin colisión con los ~60 existentes. |
| `AUDIT_IP` | `net` | El log de actividad guarda la red (`203.0.113.0/24`), no la dirección completa. |

Lo único que se tocó de la infraestructura existente fueron dos `systemctl reload nginx`.
Verificado después: n8n, Open WebUI, Coolify, huerto, hermes y Zammad responden igual que antes.

### 10.3 Divergencias respecto al plan de investigación

* **El `api` se construye desde la raíz del repo** (`context: .`, `dockerfile: api/Dockerfile`),
  no desde `./api`. Sin eso el contenedor no puede `COPY frontend/src/lib`, y sin las libs del
  frontend el endpoint tendría que reimplementar el catálogo, el matcher y `normalizeRepRange`
  — dos fuentes de verdad para lo mismo. Es el mismo enfoque que usa `mcp/`. Coste: la imagen
  prebuilt de `registry.gitlab.com` ya no sirve; hay que usar `--build`.
* **Se añadió `api/exercise-aliases.js`** (tabla es→en). No estaba previsto porque en §6 se
  asumía que la capa i18n podría aportar los nombres en español: no puede,
  `EXERCISE_NAME_LANGS = ['pt-BR', 'hu']`. Con la tabla, 60 de los 68 ejercicios del plan
  resuelven contra el catálogo y sólo 8 acaban como custom.
* **Las planchas se dejaron deliberadamente como ejercicio custom.** El dataset no tiene una
  plancha frontal ni una lateral a secas — sólo `2135 weighted front plank` y
  `1775 side plank hip adduction`, que son otros ejercicios. Un custom honesto es mejor que
  archivar un isométrico bajo un parecido.
* **Descargas (opción (a), la que elegiste):** rutinas gemelas con `excludeFromProgression: true`
  y series reducidas un 40 %, programadas en `dayPlan` a partir de `start_date`. 25 rutinas en
  total en vez de 12. Sin `start_date` se crean igual, pero el import avisa de que no las ha
  puesto en el calendario.
* **Rango de reps bajo doble progresión:** un `"reps": "10"` plano se expande a `8-10` pasándolo
  por `normalizeRepRange` de la app, y se reporta como warning. La app haría exactamente eso al
  leerlo, pero implícitamente; escribirlo hace que el rango se vea en el editor.

### 10.4 Lo que el endpoint NO resuelve

* **No hay lock contra el `PUT /api/data` del navegador.** Es el mismo hueco que el propio
  roadmap del MCP declara para su Fase 2. Importar con la app cerrada; documentado en
  `docs/IMPORT_API.md` §7 y en `docs/SELF_HOSTING.md`.
* **`user_id` no es una frontera de permisos.** Una sola clave puede escribir el plan de
  cualquier perfil de la instancia. Es una credencial de operador, no un token por usuario.
* **La doble progresión de openGym sube tras una sesión, no dos.** Tu regla ("techo del rango en
  todas las series durante 2 sesiones seguidas") no es expresable; `double` es lo más cercano.

---

## 11. Reconciliación de fork (2026-09-02, sesión 2)

### 11.1 Qué hay realmente

Hay **tres** repos de GitHub en juego, más el remoto real de GitLab:

| Remoto | URL | HEAD | Permisos de la cuenta logueada (`albertoalbaladejo`) |
|---|---|---|---|
| `origin` | `github.com/aalbaladejocortes/openGym` | `c42ba6b` | `pull` sólo — es de otra cuenta |
| `fork` | `github.com/albertoalbaladejo/openGym` | `c42ba6b` | **`admin`/`push`** ✔ |
| `upstream-gitlab` | `gitlab.com/DuarteSantos8/opengym` | `272bf78` | lectura |

`albertoalbaladejo/openGym` se creó el **2026-09-02T10:25Z** (durante la sesión anterior), es
fork de `arvids-unavailable/openGym` (no de `aalbaladejocortes`), es **público**, y tiene
`main` como rama por defecto. Sólo tiene `fork/main`, **0 tags, 0 workflows registrados**.

### 11.2 El hallazgo que decide el plan

```
$ git rev-parse fork/main backup/pre-sync-v1.2.4
c42ba6b98e3776af5981f20c05ba392238799670
c42ba6b98e3776af5981f20c05ba392238799670   ← el mismo commit

$ git merge-base fork/main main
SIN ANCESTRO COMUN

$ git rev-list --left-right --count fork/main...main
5   423
```

**`fork/main` es exactamente `backup/pre-sync-v1.2.4`**: la misma historia aplastada de 5 commits
(`asd`, `asd`, `Create render.yaml`, `commit`, `Initial commit`) que tenía
`aalbaladejocortes/openGym`. Y **no comparte ningún ancestro** con la historia real de GitLab.
Las dos cadenas de forks de GitHub arrancan de un squash que tiró la historia del proyecto.

Consecuencia operativa: **`git push fork main` no puede ser fast-forward.** Hace falta `--force`
(o empujar a otra rama y cambiar la rama por defecto). No es un caso de "resolver conflictos":
son dos árboles de commits inconexos con contenido casi idéntico.

### 11.3 Qué contiene `fork/main` que no debería

`git diff --name-status v1.2.4 fork/main` sobre 2671 ficheros:

* **Borrados** respecto a v1.2.4: `.gitignore`, `.dockerignore`, `.env.example`, y todo
  `.github/` (workflows, plantillas de issue, dependabot, FUNDING).
* **Añadidos**: `.DS_Store` en 5 directorios, `nginx.conf` y `render.yaml` sueltos en la raíz,
  `web/Dockerfile` renombrado a `Dockerfile`, y los ~2670 ficheros de `media/` comiteados.
* **Añadidos, y esto importa**: `data/db.json`, `data/secret` y `data/vapid.json`.

`data/secret` es la clave HMAC de sesión y `data/vapid.json` contiene la clave privada VAPID —
en un repositorio **público**. `data/db.json` lleva el uid, el nombre y la clave pública de
passkey de un tercero (`Arvids`, `piYdx5GveQarq8u9`).

**Esto NO es una fuga de datos tuyos.** Comprobado:

```
secret comiteado:   1ba7c4c51338dda8c71c64e028d003522abb87f8c87f50ca3fcd2940ea7f7e79
secret en producción: a45a6a074714e10d9261d2e3f85630c02b46a820cc85d0eb6545d8a7bc385391   ← distinto
```

Son de `arvids-unavailable`, y ya eran públicos en el repo padre antes de que existiera tu fork.
Tu instancia generó claves nuevas: el `git reset --hard upstream-gitlab/main` de la sesión
anterior borró los `data/*` trackeados (en upstream ese directorio está gitignorado), y el
contenedor `api` creó un `secret` y un `vapid.json` propios en el primer arranque. `db.json` de
producción está a `0 users`.

Aun así, no hay razón para propagar esos ficheros: el plan de §11.4 los deja fuera de la rama por
defecto.

### 11.4 Qué está en riesgo y qué no

Los 5 commits de `fork/main` **no contienen nada del trabajo de la sesión anterior** — el endpoint,
los tests y la documentación viven en `cce7769`, encima de la historia de GitLab. Si un
force-push los descarta de la rama por defecto, siguen existiendo en cuatro sitios:
`backup/pre-sync-v1.2.4` en local, el tarball `/home/ubuntu/opengym-backup-20260902.tar.gz`,
`aalbaladejocortes/openGym`, y el repo padre `arvids-unavailable/openGym`.

### 11.5 Nota sobre los workflows heredados

`albertoalbaladejo/openGym` tiene Actions **habilitadas** (`{"enabled":true,"allowed_actions":"all"}`)
y **0 workflows registrados**, porque el árbol de `fork/main` borró `.github/`. En cuanto se empuje
la historia de upstream a `main`, se registrarán y dispararán dos que vienen de upstream y que
tienen `on: push: branches: [main]`:

* `docker-publish.yml` — publicaría imágenes en el GHCR de tu cuenta;
* `pages.yml` — desplegaría la demo a GitHub Pages (falla si Pages no está activado).

Ninguno de los dos es algo que quieras en un fork personal. Se tratan en el plan.

### 11.6 Lo que se ejecutó (tras tu confirmación)

```
$ git push fork main --force-with-lease
 + c42ba6b...272bf78 main -> main (forced update)

$ git push fork feat/import-plan-api
 * [new branch]      feat/import-plan-api -> feat/import-plan-api

$ git push fork --tags
 * [new tag]         v1.2.2 … v1.2.14
```

Verificación contra la API de GitHub, no contra la salida de `git`:

```
$ git ls-remote fork refs/heads/main refs/heads/feat/import-plan-api
cce7769ba6ff43334e02d782005d18f35ab976ff  refs/heads/feat/import-plan-api
272bf785ee18e0694fe047c60729a5a0e0224938  refs/heads/main

$ gh api /repos/albertoalbaladejo/openGym/commits/cce7769 --jq '.files[].filename' | wc -l
18
```

* **PR abierto:** <https://github.com/albertoalbaladejo/openGym/pull/1>.
* **Workflows heredados desactivados** por API (`disabled_manually`): `docker-publish.yml`,
  `pages.yml`. El run de `Publish Docker images` que llegó a arrancar con el push se canceló.
  `test.yml` se dejó **activo** (corre los tests del frontend, es útil). `sync-upstream.yml`
  todavía no aparece registrado porque vive en la rama del PR: los `schedule:` sólo corren desde
  la rama por defecto, así que se activará al mergear el PR.
* **`backup/pre-sync-v1.2.4` NO se empujó**, a propósito (§11.3): empujar esos 5 commits a un
  repo público volvería a publicar `data/secret` y `data/vapid.json`. Sigue en local, en el
  tarball, en `aalbaladejocortes/openGym` y en `arvids-unavailable/openGym`.
* **Remotos de la VPS reordenados**: `origin` → `github.com/albertoalbaladejo/openGym`, y se
  quitó el remoto `fork` (era el mismo). `aalbaladejocortes` ya no está configurado. `main` y
  `feat/import-plan-api` siguen a `origin/*`. No hizo falta redesplegar: Docker construye desde
  el árbol de trabajo, no desde el remoto — contenedores con el mismo uptime antes y después.

---

## 12. i18n — la UI en español

### 12.1 ¿Existe capa de i18n?

Sí, completa, y **el español ya está traducido al 100 %**. No hay que implementar nada.

```
frontend/src/lib/i18n-core.js   estado + lectores puros (t, exerciseNameFor, dateLocale), Node-safe
frontend/src/lib/i18n.js        los trozos de Vite/React (import.meta.glob, el hook de suscripción)
frontend/src/locales/*.js       14 paquetes de idioma
frontend/src/instr/*.js         instrucciones de ejercicio, 12 idiomas
frontend/src/exercise-names/*.js  nombres de ejercicio traducidos — sólo 2 idiomas
```

```js
// i18n-core.js
export const LANGS = { en, de, es: 'Español', fr, it, pt, 'pt-BR', pl, tr, ru, zh, ko, hi, th, hu }
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko', 'pt-BR', 'hu']
export const EXERCISE_NAME_LANGS = ['pt-BR', 'hu']
```

Cobertura medida:

| Fichero | Claves | Comparación |
|---|---|---|
| `locales/es.js` | **719** | idéntico en número a `de`, `fr`, `it` — es decir, completo |
| `instr/es.js` | presente | el español está en `INSTR_LANGS` |
| `exercise-names/es.js` | **no existe** | sólo hay `pt-BR.js` y `hu.js` |

Las claves son las propias cadenas inglesas (`'Cancel': 'Cancelar'`), así que una cadena sin
traducir cae con elegancia al inglés en vez de mostrar un identificador.

Y los dos chunks del español **ya están desplegados**: `assets/es-B6eXLS-1.js` y
`assets/es-BFUs4tR4.js` dentro del contenedor `web`.

### 12.2 Entonces, ¿por qué la ves en inglés?

Porque openGym **no detecta el idioma del navegador**. `grep -rn "navigator.language" frontend/src`
no devuelve nada, y el store arranca con:

```js
// store/useStore.js:12
unit: 'kg', restSec: 90, …, lang: 'en',
```

El idioma es un ajuste persistido que empieza en `en` y sólo cambia si lo cambias tú.
**Arreglo: Ajustes → Idioma → Español.** Cero código.

Queda un cambio *opcional* si quieres que arranque en español solo: leer `navigator.language`
la primera vez que se crea el estado. Son ~3 líneas en `useStore.js`, pero es una divergencia
propia con upstream que habrá que reconciliar en cada sync semanal, a cambio de un clic que se
hace una sola vez.

### 12.3 ¿La capa es→en del endpoint es independiente de lo que se ve en pantalla?

**Completamente.** No se tocan ni comparten nada:

| | `api/exercise-aliases.js` | `frontend/src/exercise-names/` |
|---|---|---|
| Dónde corre | servidor, contenedor `api` | navegador |
| Cuándo | una vez, durante el import | en cada render |
| Qué hace | frase en español → **id del catálogo** | id → **nombre traducido para mostrar** |
| Qué escribe | ids en `state-<uid>.json` | nada, es sólo lectura |
| Idiomas | es → en (68 entradas curadas) | pt-BR, hu |

El import guarda **ids** (`'0025'`), nunca nombres. Cómo se muestre ese id después es asunto
exclusivo de la capa i18n. Traducir la UI no puede romper un import ya hecho, y cambiar la tabla
de alias no puede cambiar lo que ves de un plan ya importado.

### 12.4 Alcance real de traducir lo que falta

Sólo faltan los **nombres de ejercicio** (los ~1324 del dataset). El resto ya está.

* **El dataset no trae español.** `hasaneyldrm/exercises-dataset` es sólo inglés: cada entrada
  tiene un único `n`. Las traducciones de openGym se generan aparte, con los scripts que ya hay
  en el repo (`scripts/translate-pt-br-exercise-names.mjs`,
  `scripts/build-pt-br-exercise-names.mjs`, y las fuentes en `scripts/exercise-name-sources/`).
* **Es un `es.json` de 1324 líneas, no un refactor.** La infraestructura ya existe: bastaría
  `frontend/src/exercise-names/es.js` + añadir `'es'` a `EXERCISE_NAME_LANGS`. El coste real es
  la traducción en sí (y su revisión: "lever seated fly" no es "vuelo sentado con palanca"),
  no la fontanería.
* Sin eso, la UI en español muestra los nombres de ejercicio en inglés y todo lo demás en
  español — que es exactamente lo que ven hoy los usuarios de los otros 11 idiomas con
  instrucciones traducidas.

---

## 13. Por qué "se ve todo móvil" en escritorio

### 13.1 No es un bug del despliegue: el CSS de escritorio se está sirviendo

```
$ curl -s https://gym.albertoalbaladejo.com/assets/index-DHhuqVQx.css | grep -o '#app{[^}]*}'
#app{padding:calc(var(--sat) + 8px) var(--pad) calc(128px + var(--sab));max-width:560px;margin:0 auto}
#app{padding-bottom:calc(250px + var(--sab))}
#app{max-width:1080px;padding-top:32px}      ← la regla de escritorio, presente en el bundle
```

El viewport tampoco fuerza nada raro (`frontend/index.html:5`):

```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
```

`width=device-width` es lo correcto; no hay `width=375` ni un `max-width` global.

### 13.2 Sí hay diseño de escritorio, y es deliberado

`frontend/src/index.css:1035` — un bloque entero bajo `@media (min-width:1000px)`:

```css
@media (min-width:1000px){
  #app{max-width:1080px;padding-top:32px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
  #app .list{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .narrow{max-width:640px;margin:0 auto}          /* ← la clave */
  .tiles{grid-template-columns:repeat(4,1fr)}
  #tabbar{left:50%;right:auto;bottom:16px;transform:translateX(-50%);width:520px;…}
  .sheet{…width:640px}   .exmedia img{height:380px}
}
```

Sólo hay 4 media queries en toda la hoja: `prefers-reduced-motion`, `width<=400px`,
`hover:hover` y `width>=1000px`. No hay tablet ni pasos intermedios.

**Por qué sigue pareciendo un móvil ancho:** casi todas las vistas se envuelven en `.narrow`,
que en escritorio se limita a **640 px**, no a 1080. Sólo dos vistas usan la rejilla `.cols`:

| Vista | Clase | Ancho efectivo en escritorio |
|---|---|---|
| Home, Workout, Settings, Admin, RoutineEdit, Login, MobileOnboarding, ErrorBoundary | `.narrow` | **640 px** centrados |
| Plan, Stats | `.cols` | **1080 px**, dos columnas |

Es decir: el escritorio *funciona*, pero para 8 de las 10 pantallas consiste en ensanchar la
columna de 560 a 640 px y sacar la barra de pestañas a una píldora flotante centrada. No es un
fallo tuyo — es la decisión de diseño de upstream (una PWA pensada para el móvil que se deja
usar en escritorio), y no está escrita en `docs/MOBILE.md`, que sólo habla de las shells de
Capacitor y no menciona el diseño responsive en ninguna parte.

### 13.3 La única causa plausible de "no se aplica NADA"

El minificador reescribe la media query a sintaxis de rangos de Media Queries Level 4:

```
fuente:  @media (min-width:1000px)
bundle:  @media (width>=1000px)
```

Un navegador que no entienda esa sintaxis **descarta el bloque entero** y se queda en los
560 px de móvil. Soporte: Chrome/Edge ≥ 104, Firefox ≥ 102, **Safari ≥ 16.4**. `vite.config.js`
no fija `build.target` ni hay `browserslist`, así que manda el target moderno por defecto de
Vite.

**Cómo distinguir los dos casos en 10 segundos**, con la ventana maximizada, en DevTools →
Elements, seleccionando `#app` y mirando el ancho calculado:

* **640 px** (o 1080 en Plan/Stats) → el CSS de escritorio se aplica; lo que ves es el diseño
  de upstream (§13.2). El arreglo es de diseño, no de despliegue.
* **560 px** → tu navegador no entiende `(width>=1000px)`. Es un problema de target de build.

### 13.4 Arreglo mínimo propuesto, sin tocar el layout móvil

Todo lo que sigue vive dentro de `@media (min-width:1000px)`, así que **por debajo de 1000 px no
cambia ni un píxel**.

1. **Si el ancho calculado sale 560 px** — fijar el target de CSS en `vite.config.js` para que la
   media query se emita en sintaxis clásica:
   ```js
   build: { cssTarget: ['chrome87', 'safari14'] }
   ```
   Una línea, sin divergencia visual, y arregla también cualquier otra sintaxis moderna que el
   minificador haya emitido.

2. **Si sale 640 px** — subir `.narrow` en escritorio, que es el único número que mantiene ocho
   pantallas con aspecto de móvil:
   ```css
   @media (min-width:1000px){ .narrow{max-width:820px} }
   ```
   Un valor, dentro del bloque que ya existe. 820 px mantiene la línea de texto legible
   (~90 caracteres) y aprovecha bastante más pantalla.

3. **Opcional, y ya no es mínimo:** poner `Home` y `Settings` en `.cols` como ya están `Plan` y
   `Stats`. Eso sí toca JSX y hay que mirar pantalla por pantalla si las tarjetas quedan bien en
   dos columnas. No lo haría sin ver antes capturas.

Recomendación: hacer el diagnóstico de §13.3 primero. Los arreglos 1 y 2 tratan causas
distintas y sólo uno de los dos es el tuyo.

### 13.5 Lo aplicado

Arreglo 1 de §13.4, en `frontend/vite.config.js`:

```js
build: { chunkSizeWarningLimit: 1500, cssTarget: ['chrome87', 'safari14', 'firefox78', 'edge88'] }
```

Verificado sobre el bundle realmente servido, después de `docker compose up -d --build web`:

```
                          antes (index-DHhuqVQx.css)   después (index-C6uqe8bm.css)
@media (width<=400px)     sí                            —
@media (width>=1000px)    sí                            —
@media (max-width:400px)  —                             sí
@media (min-width:1000px) —                             sí
```

Las reglas son las mismas (`max-width:1080px` sigue ahí); sólo cambia la sintaxis con que se
emiten. En un navegador moderno no cambia nada; en uno anterior a Safari 16.4 / Chrome 104, el
bloque de escritorio deja de descartarse.

**Sigue pendiente el diagnóstico de §13.3.** Si con el bundle nuevo `#app` sigue midiendo 640 px
con la ventana maximizada, la causa era la de §13.2 (`.narrow`, decisión de diseño de upstream) y
el arreglo es el 2, no el 1.

---

## 14. Un límite del esquema que sólo aparece al reducir días (2026-09-02)

Al bajar el plan a 3 sesiones semanales hubo que fusionar el split de 4 días de la Fase 2
(Torso A/B + Pierna A/B) en 3. La alternativa natural en papel — rotar los 4 días sobre 3
sesiones, de forma que la semana 1 sea A/B/C y la semana 2 D/A/B — **no es representable en
openGym**, y conviene tenerlo escrito porque no es obvio:

```js
// history.js
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return null
  if (ov && S.routines.some(r => r.id === ov)) return ov
  const wd = new Date(iso + 'T12:00:00').getDay()
  return S.week[wd] || null          // ← un día de la semana, una rutina, siempre
}
```

`S.week` es un mapa **día de la semana → rutina**, sin noción de número de semana. La única forma
de que un lunes concreto tenga otra cosa es una entrada explícita en `S.dayPlan` para **esa fecha
exacta**. Una rotación A/B sobre 24 semanas se podría *simular* escribiendo ~72 entradas de
`dayPlan` a mano, pero entonces el plan deja de vivir en `week` (lo que la app enseña como "tu
semana") y pasa a ser una lista de fechas: la vista Plan mostraría una semana que no es la que
realmente se entrena. Se descartó por eso, no por esfuerzo.

Consecuencia práctica para cualquier plan que se importe aquí: **el split tiene que caber en 7
días fijos**. Un 4-day split necesita 4 días distintos de la semana; si sólo hay 3, hay que
fusionar de verdad, no rotar.

Esto también explica `prune_phase_routines` (§ `docs/IMPORT_API.md` 6.1): fusionar días cambia
los **nombres** de las rutinas, y el upsert por nombre no puede saber que `F2 · Torso A` fue
sustituida por `F2 · Full Body A` — sólo ve que una ya no se produce. Sin un borrado explícito,
cada rediseño del plan deja sedimento en la vista Plan.
