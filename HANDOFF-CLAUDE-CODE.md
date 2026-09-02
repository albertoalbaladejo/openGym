# HANDOFF — openGym (Alberto)

Estado vivo del trabajo. Se actualiza en cada paso.
Última actualización: **2026-09-02, sesión 5 — IMPORT REAL EJECUTADO. Nada del proyecto queda bloqueado.**

---

## 1. Qué de la sesión anterior sigue intacto, y dónde vive AHORA

Todo. Nada se ha perdido, sobrescrito ni rehecho. Verificado con `git log` al abrir la sesión:

| Artefacto | Dónde vive ahora | Hash / prueba |
|---|---|---|
| Endpoint `POST /api/admin/import-plan` + tests + docs | **`main`**, vía PR #1 mergeado | **`cce7769`**, merge `c20f8c4` |
| Fork sincronizado a upstream GitLab v1.2.14 | **`main`** | `c20f8c4` (= `272bf78` + los 3 commits del PR) |
| Historia previa del fork (v1.2.4 aplastado) | rama local **`backup/pre-sync-v1.2.4`** | `c42ba6b` |
| `SCHEMA_NOTES.md`, `docs/IMPORT_API.md`, `scripts/import-plan.mjs`, `.github/workflows/sync-upstream.yml`, `plans/plan-alberto-6-meses.json` | dentro de `cce7769` | — |
| Despliegue vivo | `/home/ubuntu/opengym` en la VPS, contenedores `opengym-api-1` / `opengym-web-1` | `https://gym.albertoalbaladejo.com` → 200 |
| Copia fuera de git | `/home/ubuntu/opengym-backup-20260902.tar.gz` | 137 MB, `chmod 600`, incluye `.git/`, `.env` y `data/` completos (excluye `media/` y `node_modules/`) |

**Ya está todo en el remoto correcto.** Verificado contra la API de GitHub, no contra la salida
de `git`:

```
$ git ls-remote origin refs/heads/main refs/heads/feat/import-plan-api
cce7769ba6ff43334e02d782005d18f35ab976ff  refs/heads/feat/import-plan-api
272bf785ee18e0694fe047c60729a5a0e0224938  refs/heads/main

$ gh api /repos/albertoalbaladejo/openGym/commits/cce7769 --jq '.files[].filename' | wc -l
18
```

**El commit de `feat/import-plan-api` existe en el remoto correcto
(`albertoalbaladejo/openGym`) en el hash `cce7769ba6ff43334e02d782005d18f35ab976ff`.**
PR abierto: <https://github.com/albertoalbaladejo/openGym/pull/1>.

`backup/pre-sync-v1.2.4` **no se empujó a propósito**: sus 5 commits llevan `data/secret` y
`data/vapid.json` (de `arvids-unavailable`, no tuyos) y el repo es público. Sigue en local, en el
tarball, y en los dos repos donde ya estaba.

## 2. Dónde estamos

- [x] **§0 Protección** — ramas verificadas, tarball en `/home/ubuntu/opengym-backup-20260902.tar.gz`.
- [x] **§1 Reconciliación** — investigada (`SCHEMA_NOTES.md` §11) y **ejecutada** (§11.6).
      Force-push a `main`, rama y tags empujados, PR #1 abierto, `docker-publish.yml` y
      `pages.yml` desactivados, `origin` repuntado a `albertoalbaladejo/openGym`.
- [ ] **§2 Passkey** — **esperando a que Alberto cree el perfil desde el móvil.** Los pasos
      están abajo; la verificación en servidor la hago yo después.
- [x] **§3 i18n** — investigado, `SCHEMA_NOTES.md` §12. **Resultado: no hay nada que
      implementar**, el español ya está al 100 % (719 claves) y desplegado. Es un ajuste.
- [x] **§4 Responsive** — investigado (`SCHEMA_NOTES.md` §13) y **aplicado el arreglo de build**
      (§13.5): `cssTarget` en `vite.config.js`, contenedor `web` reconstruido, verificado que el
      bundle emite `@media (min-width:1000px)` en vez de `(width>=1000px)`. **Falta tu medida
      del ancho de `#app`** para saber si con eso basta o hace falta además subir `.narrow`.

## 3. Hechos de infraestructura que no están en el repo

- Puerto host **8090** (`WEB_PORT=127.0.0.1:8090` en `.env`); 8080 lo ocupa `ktor-huertando`.
- vhost `/etc/nginx/sites-available/gym.albertoalbaladejo.com`, cert Certbot webroot hasta 2026-12-01.
- `IMPORT_API_KEY` sólo en `/home/ubuntu/opengym/.env` (gitignored, `chmod 600`).
- El contenedor `api` se construye desde la **raíz** del repo (`context: .`) para poder
  `COPY frontend/src/lib`. La imagen prebuilt no sirve: siempre `docker compose up -d --build`.
- Secretos de producción (`data/secret`, `data/vapid.json`) son **propios y distintos** de los
  que `fork/main` lleva comiteados (ver `SCHEMA_NOTES.md` §11.3).

## 4. Lo siguiente, y qué necesito de ti

### §2 — Passkey (bloqueado en ti)

1. Abre **https://gym.albertoalbaladejo.com** en el móvil, en Safari o Chrome (no dentro del
   navegador de Instagram/WhatsApp: los WebViews no hacen ceremonias WebAuthn).
2. Pulsa **Create profile** / **Crear perfil** y escribe un nombre.
3. El sistema pedirá Face ID / huella / PIN. Acéptalo — ahí es donde se crea la passkey.
4. Dímelo y verifico en el servidor (`data/db.json`, `data/audit.log`, logs del contenedor) que
   la credencial quedó bien guardada.

Después de eso: **Ajustes → Idioma → Español**, y ya puedo lanzar el import de tu plan.

### §3 y §4 — decisiones de alcance pendientes

* **i18n:** decidido — nada que implementar. Ajustes → Idioma → Español.
* **Responsive:** aplicado el `cssTarget`. Con la ventana maximizada y **recargando con
  Ctrl+Shift+R** (el bundle cambió de nombre: `index-C6uqe8bm.css`), dime el ancho calculado de
  `#app` en DevTools → Elements. **640 px** ⇒ era diseño de upstream y toca subir `.narrow` a
  820 px; **1080 px** en Plan/Stats y 640 en el resto ⇒ funcionando como upstream lo diseñó;
  **560 px** ⇒ algo más lo está tapando y hay que seguir mirando.

---

## 5. Sesión 3 — qué se hizo

### §1 PR #1 mergeado, cron de sync activo — **hecho y verificado**

* 43/43 tests de `api/` pasando contra el árbol actual antes de mergear.
* CI del PR en verde: `test SUCCESS`, `mcp SUCCESS`. `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`.
* Mergeado con merge commit (no squash, para que `main` siga siendo descendiente de la historia
  de GitLab y `origin/main..upstream-gitlab/main` siga significando algo):
  **`c20f8c4b57847e79d202d7dfe73984040997da5e`**.
* `sync-upstream.yml` pasa a `[active]` — el cron semanal (lunes 06:17 UTC) queda desbloqueado.
* **Probado de verdad, no asumido:** lanzado a mano con `workflow_dispatch`
  (run `33626728783`, `conclusion: success`). Log: `Upstream is 0 commit(s) ahead of this fork's
  main.` → paso `Nothing to do` ejecutado, pasos de merge/push/PR `skipped`, ningún PR espurio abierto.

Estado de los workflows: `sync-upstream.yml` y `test.yml` **activos**; `docker-publish.yml` y
`pages.yml` en `disabled_manually`.

### §2 Passkey — **NO existe todavía**

```
$ curl -s https://gym.albertoalbaladejo.com/api/health
{"ok":true,"users":0}

$ sudo ls /home/ubuntu/opengym/data/
audit.log  secret  vapid.json          ← no hay db.json

$ sudo cat data/audit.log
{"ev":"import.denied", …}  ×4          ← sólo mis propias pruebas del endpoint

$ docker compose logs api --since 3h | grep -iE "register|login|verify"
(vacío)
```

**Cero intentos de registro llegaron al servidor.** No es que la ceremonia fallara: no se
intentó. `db.json` sólo se escribe cuando alguien completa `register/verify`.

Qué falta, exactamente:

1. Abrir **https://gym.albertoalbaladejo.com** en **Safari o Chrome** del móvil. No dentro del
   navegador embebido de Instagram/WhatsApp/Telegram: esos WebViews no ejecutan ceremonias
   WebAuthn y el botón parecerá que no hace nada.
2. Pulsar **Create profile** y escribir un nombre.
3. Aceptar el Face ID / huella / PIN que pida el sistema. Ahí es donde se crea la passkey.

Si algo falla en el paso 3, el error del navegador es la información útil — pásamelo tal cual.

### §3 Import real — **bloqueado en §2**, pero con el preflight hecho

No se puede importar contra un perfil que no existe (el endpoint responde `404` con la lista de
perfiles, que está vacía). Lo que **sí** está hecho y verificado con el código actual:

Dry-run del plan real contra una instancia aislada (`DATA_DIR` de usar y tirar, perfil ficticio),
para confirmar que los números no se han movido desde la sesión anterior:

```
routines    25 created, 0 updated
exercises   60 matched in the catalogue, 8 created as custom, 0 custom reused
calendar    30 day overrides would be written (deload weeks)
```

**Idéntico a lo verificado antes** (60 / 25 / 8 / 0 sin resolver). En cuanto exista el perfil, el
import real son dos comandos: el backup manual extra y el `import-plan.mjs` sin `--dry-run`.

### §4 Integración con un LLM externo — **diseño escrito, sin código**

`docs/LLM_INTEGRATION.md`. Conclusión corta:

* **Extender el `mcp/` no sirve para este caso.** Es stdio: el cliente LLM tiene que estar en la
  misma máquina que `./data`, y aquí `./data` está en la VPS. Su propio roadmap ya lo dice — el
  transporte HTTP es **Fase 3**, no Fase 2. Sería un contenedor nuevo, un vhost nuevo, un
  certificado nuevo y una segunda vía de auth, para llegar a una máquina que ya es alcanzable
  por `https://gym.albertoalbaladejo.com`.
* **La ruta corta es el endpoint que ya existe + `api/openapi.yaml`**, que ya documenta *todas*
  las rutas en OpenAPI 3.1 y cuya propia cabecera dice "si añades una ruta allí, añádela aquí
  también". El endpoint del fork es la única que falta. Documentarlo ahí lo hace invocable por
  cualquier LLM con function calling, sin contenedores nuevos.
* **Si más adelante quieres el tool MCP**, que sea un cliente HTTP de ese mismo endpoint, no un
  segundo escritor sobre `./data`: una vía de escritura, un lock, un audit trail.
* **El write-lock** se propone en tres capas: `expected_ts` + `409` (lo que de verdad resuelve el
  problema), fichero de lock para imports concurrentes, y `423` si hay un entreno en curso
  usando el mapa `presence` que el servidor ya mantiene. Con un límite honesto documentado: el
  heartbeat de `/api/activity` sólo late **durante un entreno** (`Workout.jsx:625`, cada 20 s),
  así que una app abierta pero ociosa sigue siendo invisible. La regla operativa "importa con la
  app cerrada" sobrevive al diseño.

---

## 6. Sesión 4 — checklist final

| # | Punto | Estado |
|---|---|---|
| 1 | PR #1 mergeado y verificado en el remoto | ✅ **sigue así** |
| 2 | Passkey creada y verificada en servidor | ⛔ **BLOQUEADO — depende de ti** |
| 3 | Import real ejecutado y verificado en la app desde el móvil | ⛔ **BLOQUEADO por el punto 2** |
| 4 | `openapi.yaml` actualizado con el endpoint | ✅ hecho |
| 5 | `expected_ts` + `409` implementado y con test | ✅ hecho |
| 6 | `state_ts` en la respuesta, documentado | ✅ hecho |
| 7 | Recuento de tests | ✅ **43 → 48**, todos verdes |
| 8 | `docs/IMPORT_API.md` actualizado con el contrato nuevo | ✅ hecho (§2.1 nueva) |
| 9 | `LLM_INTEGRATION.md`: qué se implementó y qué queda | ✅ hecho (§5 con columna de estado, §6 "Pendiente") |
| 10 | `mcp/` sin tocar ni duplicar | ✅ confirmado |
| 11 | `sync-upstream.yml` sigue activo | ✅ `[active]`, no hacía falta relanzarlo |
| 12 | Hallazgos nuevos no resolubles por mí | ✅ anotados abajo |

### Punto 1 — PR #1 (verificado contra la API de GitHub)

```
$ gh api /repos/albertoalbaladejo/openGym/branches/main --jq .commit.sha
2f1dffad7eadceae1c96aec4205b86a1084fc855   (antes de los commits de esta sesión)
$ git merge-base --is-ancestor cce7769 origin/main  →  sí
```

`cce7769`, `7c67519`, `28a1e54` y el merge `c20f8c4` siguen alcanzables desde `main`.

### Punto 2 — Passkey: BLOQUEADO, y no es un fallo del servidor

```
$ curl -s https://gym.albertoalbaladejo.com/api/health
{"ok":true,"users":0}
$ sudo ls data/            → audit.log  secret  vapid.json      (sigue sin db.json)
$ sudo cat data/audit.log  → 4 líneas, todas import.denied de mis propias pruebas
$ docker compose logs api --since 24h | grep -iE "register|login|verify"  → vacío
```

**Cero peticiones de registro han llegado al servidor en 24 h.** El lado servidor está
comprobado y correcto:

```
rp: {'name': 'openGym', 'id': 'gym.albertoalbaladejo.com'}
authenticatorSelection: {'residentKey': 'required', 'userVerification': 'preferred'}
config: {"invite_only":false,"allow_guest":true}
```

Sin `Permissions-Policy` que bloquee WebAuthn. `POST /api/register/options` responde bien por
HTTPS con el RP correcto.

**Lo que debes ver al abrir https://gym.albertoalbaladejo.com en el móvil** (de `Login.jsx`):
el logo de mancuerna, "openGym", y **tres** botones — *Sign in with passkey*, *Create new
profile*, *Continue without account*.

* Si ves los tres → pulsa **Create new profile**, pon nombre, acepta Face ID/huella. Si falla
  ahí, el mensaje de error del navegador es lo único útil: pásamelo literal.
* Si en vez de los dos primeros botones ves **una tarjeta gris** diciendo que el navegador no
  soporta passkeys → `window.PublicKeyCredential` no existe, que en la práctica significa
  **estás en un WebView** (el navegador embebido de Instagram / WhatsApp / Telegram / LinkedIn).
  Ábrelo en Safari o Chrome de verdad.

### Punto 3 — Import real: BLOQUEADO, con el preflight ya hecho

El endpoint responde `404 {"error":"this instance has 0 profiles — pass user_id","profiles":[]}`.
No se puede importar contra un perfil inexistente.

Preflight repetido en esta sesión contra instancia aislada, con el código actual:

```
routines    25 created, 0 updated
exercises   60 matched in the catalogue, 8 created as custom, 0 custom reused
calendar    30 day overrides would be written (deload weeks)
```

**Idéntico a lo verificado en las dos sesiones anteriores.** En cuanto exista el perfil:

```bash
sudo cp data/state-<uid>.json data/state-<uid>.json.manual-$(date +%Y%m%d-%H%M%S)   # backup extra
node scripts/import-plan.mjs plans/plan-alberto-6-meses.json --dry-run              # anota state_ts
node scripts/import-plan.mjs plans/plan-alberto-6-meses.json --expected-ts <ese state_ts>
```

Y después, lo que tendrás que mirar tú en el móvil (yo no puedo: no hay navegador conectado a
esta sesión y la vista Plan no se puede leer desde el JSON):

* pestaña **Plan** → 25 rutinas, empezando por `F1 · Full Body`, `F1 · Full Body (descarga)`,
  `F1 · Cardio moderado`, `F2 · Torso A`…
* abre `F2 · Torso A` → 12 ejercicios; *Press de banca plano* debe decir **4 × 8-10**;
  *Curl de bíceps con mancuernas* y *Extensión de tríceps en polea* deben salir **enlazados como
  superserie**; los tres últimos (*Chin tucks*, *Estiramiento de pectoral*, *Wall angels*) llevan
  la nota **postural**.
* la vista de semana: Lun/Mié/Vie `F1 · Full Body`, Mar/Sáb `F1 · Cardio moderado`,
  Jue/Dom `Postural diario`.
* *Plancha lateral* en `F2 · Torso B` debe mostrarse en **segundos (0:30)**, no en repeticiones.

### Puntos 4-6 — lo implementado

* **`api/openapi.yaml`**: ruta `/api/admin/import-plan` (`operationId: importPlan`), tag `import`,
  `securitySchemes.importKey` (`apiKey` en la cabecera `X-Import-Key`), y 6 esquemas nuevos
  (`ImportPlanRequest`, `ImportPhase`, `ImportDay`, `ImportExercise`, `ImportPlanSummary`,
  `ImportConflict`). Respuestas documentadas: 200, 400, 401, 404, 409, 429, 501 — exactamente las
  que el servidor devuelve, ni una de más.
  Validado con `npx @redocly/cli lint`: **"Your API description is valid"**, 6 warnings, **ninguna
  sobre la ruta nueva** (son las 5 rutas preexistentes sin respuesta 4xx y el `example.com` de
  `servers`). 27 → **28 rutas**, 0 `$ref` rotas.
* **`expected_ts` + `409`**: comprobado *antes* de leer nada más y mucho antes de escribir.
  `null` es un valor con significado ("planifiqué contra un perfil que nunca ha sincronizado"),
  no una ausencia. Omitir el campo mantiene el comportamiento anterior — el script y los imports
  a mano ya en uso no se rompen. El conflicto se registra como `import.conflict` en el audit log.
* **`state_ts`** en toda respuesta 200: *siempre* "lo que mandar como `expected_ts` la próxima
  vez" — tras un import real, el timestamp recién escrito; tras un `dry_run`, el intacto que hay
  en disco. Así un LLM encadena llamadas sin necesitar una segunda ruta de lectura (que es
  justamente lo que no queremos crear, ver punto 10).
* **`scripts/import-plan.mjs`**: `--expected-ts <n|null>`, imprime `state_ts`, y explica el 409
  diciendo con qué valor reintentar.

Probado de punta a punta contra una instancia aislada: dry-run → `state_ts: null` → import real
con `--expected-ts null` → `state_ts: 1788351179452` → repetir con el `null` viejo → **409** con
`actual_ts` correcto y sin escribir.

### Punto 7 — tests

**43 → 48.** Los 5 nuevos están en `api/import-auth.test.js` y cubren: semántica de `state_ts`
(dry-run vs escritura real), `expected_ts` correcto incluido `null`, `expected_ts` desfasado →
409 sin escribir, ausencia del campo → comportamiento antiguo, y `expected_ts` no numérico → 400.
`cd api && node --test` → **48/48**.

### Punto 10 — `mcp/` intacto

`git status --short mcp/` y `git diff --stat HEAD -- mcp/` → vacíos. No se ha leído para
modificar, ni cambiado, ni duplicada su función de lectura. El endpoint HTTP no ha ganado
superficie de lectura: sigue contestando sólo sobre el import que acaba de hacer. Documentado en
`docs/LLM_INTEGRATION.md` §6.4.

### Punto 12 — hallazgo nuevo, menor, no bloqueante

`curl -sI https://gym.albertoalbaladejo.com/` devuelve **`X-Frame-Options` dos veces**:
`DENY` (del nginx dentro del contenedor `web`) y `SAMEORIGIN` (del vhost del host que escribí
yo). Ante valores en conflicto los navegadores aplican el más restrictivo, así que el efecto real
es `DENY` — que es lo que openGym quiere. Es duplicación cosmética, no un fallo. Se arregla
quitando las cabeceras duplicadas de `/etc/nginx/sites-available/gym.albertoalbaladejo.com`.
**No lo he tocado** porque implica editar el vhost y recargar nginx por algo puramente estético.
Dime si quieres que lo limpie.

---

## 7. Sesión 5 — el import real, ejecutado

### 7.1 Passkey verificada en el servidor

```
$ curl -s https://gym.albertoalbaladejo.com/api/health
{"ok":true,"users":1}                     ← antes era 0
```

`data/db.json`:

| campo | valor |
|---|---|
| `users[0].id` | `3TR-nhgjg3tPyw4R` |
| `users[0].name` | `Alberto` |
| `users[0].created` | `2026-09-02T12:24:47.463Z` |
| `creds[0].id` | `nvH4clNKoHbEuBznfGnVgg01aek` |
| `creds[0].publicKey` | `pQECAyYgASFYIFevLBhZL-X5ooAwf9ftDAHZa_qCWyYXdtGtBv8n-x-dIlgg…` (COSE EC2 P-256) |
| `creds[0].transports` | `["internal", "hybrid"]` — autenticador de plataforma + cross-device |
| `creds[0].counter` | `0` |

Audit log: `{"id":7,"ts":1788351887463,"ev":"auth.register.ok","ok":true,"uid":"3TR-nhgjg3tPyw4R","name":"Alberto"}`.

La app además ya había sincronizado un estado inicial con `lang: "es"` y `weekStart: 1`, así que
el cambio de idioma también quedó hecho.

### 7.2 Copias de seguridad antes de escribir

| Copia | Ruta |
|---|---|
| Manual (extra) | `data/state-3TR-nhgjg3tPyw4R.json.manual-20260902T122733Z` |
| Manual, fuera de `./data` | `/home/ubuntu/state-alberto-pre-import-20260902T122733Z.json` |
| Automática del endpoint | `data/state-3TR-nhgjg3tPyw4R.json.bak-2026-09-02T12-27-46-572Z` |

### 7.3 Dry-run — coincide exactamente con los tres preflights anteriores

```
state_ts    1788351896187   (unchanged — pass this to --expected-ts)
routines    25 created, 0 updated
exercises   60 matched in the catalogue, 8 created as custom, 0 custom reused
calendar    30 day overrides would be written (deload weeks)
```

`expected_ts` **no** fue `null`: la app ya había sincronizado un estado inicial, así que el valor
correcto era `1788351896187`. Exactamente el caso para el que se construyó el mecanismo.

### 7.4 Ejecución real — el resumen exacto que devolvió el endpoint

```
✓ imported  ·  profile 3TR-nhgjg3tPyw4R
  backup      state-3TR-nhgjg3tPyw4R.json.bak-2026-09-02T12-27-46-572Z
  state_ts    1788352066572   (pass this to --expected-ts next time)
  routines    25 created, 0 updated
  exercises   60 matched in the catalogue, 8 created as custom, 0 custom reused
  calendar    30 day overrides written (deload weeks)

  Created as custom exercises (not in the dataset):
    · Chin tucks                                    →  neck
    · Estiramiento de pectoral en marco de puerta   →  chest
    · Wall angels                                   →  shoulders
    · Plancha frontal                               →  waist
    · Plancha lateral                               →  waist
    · intervalos moderados cinta o bici             →  cardio
    · HIIT corto                                    →  cardio
    · cardio suave                                  →  cardio

  Week:
    Mon  F1 · Full Body        Tue  F1 · Cardio moderado    Wed  F1 · Full Body
    Thu  Postural diario       Fri  F1 · Full Body          Sat  F1 · Cardio moderado
    Sun  Postural diario
```

* **`state_ts` final: `1788352066572`.**
* **Ejercicios sin resolver: 0.**
* Audit: `{"id":9,"ts":1788352066819,"ev":"import.plan","ok":true,"uid":"3TR-nhgjg3tPyw4R","name":"Alberto","msg":"25 created, 0 updated, 8 custom"}`.

### 7.5 Evidencia del lado servidor de que llegará bien a la vista Plan

No puedo ver la interfaz renderizada, pero sí ejecutar **las mismas funciones puras que la app
usa para dibujarla**. `effectiveRoutine()` de `frontend/src/lib/history.js` — la función que
decide qué rutina toca cada día — sobre el estado realmente escrito:

```
2026-09-07 Lunes     → F1 · Full Body            2026-09-28 Lunes     → F1 · Full Body (descarga)
2026-09-08 Martes    → F1 · Cardio moderado      2026-09-29 Martes    → F1 · Cardio moderado (descarga)
2026-09-09 Miércoles → F1 · Full Body            2026-09-30 Miércoles → F1 · Full Body (descarga)
2026-09-10 Jueves    → Postural diario           2026-10-02 Viernes   → F1 · Full Body (descarga)
2026-09-11 Viernes   → F1 · Full Body            2026-10-03 Sábado    → F1 · Cardio moderado (descarga)
2026-09-12 Sábado    → F1 · Cardio moderado
2026-09-13 Domingo   → Postural diario
```

Las descargas de la semana 4 se resuelven solas por `dayPlan`. Y `F2 · Torso A`, leído con
`modeOf()` / `isPerSide()` / `EXIDX` (lo mismo que usa el editor de rutinas):

```
 1. barbell bench press                 4 × 8-10
 2. cable seated row                    4 × 8-10
 3. dumbbell seated shoulder press      3 × 8-10
 4. cable lat pulldown full range…      3 × 10-12
 5. lever seated fly                    3 × 10-12
 6. cable rear delt row (with rope)     3 × 15-20    note="postural"
 7. dumbbell biceps curl                3 × 10-12    [SUPERSERIE:sg1]
 8. cable pushdown                      3 × 10-12    [SUPERSERIE:sg1]
 9. lever seated crunch                 3 × 15-20
10. Chin tucks                          3 × 10       note="postural · retracción de barbilla…"
11. Estiramiento de pectoral…           3 × 0:30     note="postural · por lado"
12. Wall angels                         3 × 10       note="postural"
```

Rangos rellenados, superserie enlazada en ejercicios contiguos, isométricos en **0:30** y no en
repeticiones, bloque postural anexado con su nota.

**Ajustes y datos no tocados**, comprobado sobre el fichero escrito: `lang: es`, `weekStart: 1`,
`unit: kg`, `theme: dark`, y `workouts: 0`, `bodyweight: 0`, `exWeights: 0`.

### 7.6 Checklist de la sesión anterior — cerrado

| # | Punto | Estado |
|---|---|---|
| 1 | PR #1 mergeado y verificado | ✅ |
| 2 | Passkey creada y verificada en servidor | ✅ **cerrado en esta sesión** |
| 3 | Import real ejecutado | ✅ **cerrado en esta sesión** |
| 3b | Verificado en la app desde el móvil | ⏳ **te toca a ti** — evidencia de servidor en §7.5, qué mirar en §7.7 |
| 4 | `openapi.yaml` con el endpoint | ✅ |
| 5 | `expected_ts` + `409` con test | ✅ |
| 6 | `state_ts` documentado | ✅ |
| 7 | Tests 43 → 48, todos verdes | ✅ |
| 8 | `IMPORT_API.md` actualizado | ✅ |
| 9 | `LLM_INTEGRATION.md` §5 + §6 | ✅ |
| 10 | `mcp/` sin tocar | ✅ |
| 11 | `sync-upstream.yml` activo | ✅ |

### 7.7 Qué tienes que mirar tú en el móvil

**Antes de nada: cierra la app del todo y vuelve a abrirla.** Si sigue abierta con el estado
anterior a las 12:27 y tocas algo, su `pushState()` pisaría el import. Al reabrir en frío se
queda con la copia del servidor (`_ts` del servidor es más nuevo). Comprobado a las 12:29: el
estado en el servidor sigue intacto, nadie lo ha pisado.

1. **Pestaña Plan** → 25 rutinas, empezando por `F1 · Full Body`, `F1 · Full Body (descarga)`,
   `F1 · Cardio moderado`… hasta `Postural diario`.
2. **Abre `F2 · Torso A`** → 12 ejercicios. *barbell bench press* debe decir **4 × 8-10**.
   *dumbbell biceps curl* y *cable pushdown* deben salir **enlazados como superserie**. Los tres
   últimos llevan la nota **postural**.
3. **Vista de semana** → Lun/Mié/Vie `F1 · Full Body`, Mar/Sáb `F1 · Cardio moderado`,
   Jue/Dom `Postural diario`.
4. **`F1 · Full Body`, ejercicio 9 (*Plancha frontal*)** → debe mostrarse en **segundos (0:30)**,
   no en repeticiones.
5. **Los nombres de los ejercicios del catálogo saldrán en inglés** (*barbell bench press*), y
   sólo los 8 propios en español. No es un fallo: el dataset es sólo inglés y openGym únicamente
   tiene nombres traducidos a pt-BR y húngaro (`SCHEMA_NOTES.md` §12.4). El resto de la interfaz
   y las instrucciones de ejercicio sí están en español.
