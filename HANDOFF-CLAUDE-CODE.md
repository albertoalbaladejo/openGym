# HANDOFF — openGym (Alberto)

Estado vivo del trabajo. Se actualiza en cada paso.
Última actualización: **2026-09-02, sesión 3 — PR #1 mergeado, cron de sync activo y probado, diseño de integración LLM escrito. BLOQUEADO en el import real: el perfil de passkey todavía no existe.**

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
