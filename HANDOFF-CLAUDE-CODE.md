# HANDOFF — openGym (Alberto)

Estado vivo del trabajo. Se actualiza en cada paso.
Última actualización: **2026-09-02, sesión 2 — §1 ejecutado, §3 y §4 investigados. Pendiente: §2 (passkey, requiere tu móvil)**.

---

## 1. Qué de la sesión anterior sigue intacto, y dónde vive AHORA

Todo. Nada se ha perdido, sobrescrito ni rehecho. Verificado con `git log` al abrir la sesión:

| Artefacto | Dónde vive ahora | Hash / prueba |
|---|---|---|
| Endpoint `POST /api/admin/import-plan` + tests + docs | rama local **`feat/import-plan-api`** | **`cce7769`** (18 ficheros, +2680) |
| Fork sincronizado a upstream GitLab v1.2.14 | rama local **`main`** | `272bf78` |
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
- [x] **§4 Responsive** — investigado, `SCHEMA_NOTES.md` §13. Hay diseño de escritorio y se
      está sirviendo; falta un diagnóstico de 10 segundos en tu navegador para saber cuál de
      las dos causas es. **Nada implementado, esperando tu confirmación de alcance.**

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

* **i18n:** ¿quieres sólo el cambio de ajuste (cero código), o además autodetección de
  `navigator.language`, o además traducir los 1324 nombres de ejercicio?
* **Responsive:** hace falta el ancho calculado de `#app` en tu navegador maximizado
  (DevTools → Elements → `#app`) para saber si el arreglo es de build (`cssTarget`) o de
  diseño (`.narrow` a 820px).
