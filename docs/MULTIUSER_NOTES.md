# Varios usuarios en una instancia de openGym

**Investigación, 2026-09-02. No se ha implementado nada de este documento.** Todo lo de abajo
se comprobó ejecutando, no leyendo: sobre una instancia aislada de usar y tirar con dos perfiles
(`Ana` / `userAAA`, `Bruno` / `userBBB`) y el mismo código que corre en producción.

**El perfil real (`3TR-nhgjg3tPyw4R`) no se tocó en esta sesión.** Su `_ts` sí ha avanzado por sí
solo (`1788354238356` → `1788563782039`): el audit log registra un `auth.pair.create` — se
emparejó la app móvil — y la app sincronizó. El plan está intacto, comprobado contra la copia
posterior al import: **23 rutinas con contenido idéntico, 8 ejercicios propios, 32 días de
descarga, 0 entrenos registrados, ningún campo nuevo**. Sólo cambió la marca de tiempo.

---

## 1. Lo que ya funciona hoy, sin tocar nada

### 1.1 El aislamiento entre perfiles es real

Un fichero por perfil, y el nombre se sanea antes de tocar el disco:

```js
// api/server.js:76
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
```

Ese `replace` es lo que impide que un `user_id` con `../` se salga del directorio. **Todas** las
lecturas y escrituras de estado del servidor pasan por `stateFile(...)` o `readState(...)` —
comprobado línea a línea: no hay ni una ruta construida a mano.

Importados los dos planes, el disco queda así:

```
data/db.json                 ← perfiles + claves públicas de passkey (lo único compartido)
data/secret                  ← clave HMAC de sesión (de la instancia, no de un usuario)
data/vapid.json              ← claves push (de la instancia)
data/state-userAAA.json      18 186 bytes   23 rutinas · 8 customEx · 32 dayPlan
data/state-userBBB.json       2 138 bytes    6 rutinas · 6 customEx ·  0 dayPlan
```

Plan, historial, peso corporal, ejercicios propios y ajustes viven **enteros** dentro del fichero
del perfil. Lo único común es el catálogo de 1324 ejercicios, que es **código** (`frontend/src/lib/
exercises-data.js`), no datos: se compila dentro de la imagen y nadie puede escribir en él.

### 1.2 Los ejercicios propios no se contaminan entre perfiles

Es la pregunta con más trampa, porque los dos planes inventaron un ejercicio con el **mismo
nombre**. Resultado medido:

```
customEx de Ana  : Chin tucks · Estiramiento de pectoral · Wall angels · Plancha frontal ·
                   Plancha lateral · intervalos moderados cinta · HIIT corto · cardio suave
customEx de Bruno: Sentadilla goblet · Plancha frontal · Saltos a cajón · carrera continua ·
                   Press militar con barra · carrera

ids compartidos entre perfiles : ninguno
"Plancha frontal" en ambos     : sí — con ids DISTINTOS
rutinas de Ana que apunten a un custom de Bruno : ninguna
```

El motivo está en el diseño: `resolveExercise()` sólo mira `ctx.customEx`, que es el array del
perfil que se está importando, y `uid()` acuña un id nuevo por perfil. Dos personas pueden llamar
igual a dos ejercicios distintos sin enterarse la una de la otra.

### 1.3 `prune_phase_routines` no puede salirse del perfil indicado

El borrado opera sobre el objeto `state` que el endpoint ya cargó para **ese** `user_id`; no
recibe el directorio ni recorre ficheros. Comprobado a la fuerza: se importó una versión recortada
del plan de Ana, con `prune_phase_routines: true`, que borró 4 rutinas suyas.

```
Ana   → 0 creadas, 19 actualizadas, 4 ELIMINADAS
Bruno → state-userBBB.json BYTE-IDÉNTICO (md5 16033d9f3af8e978e19a3f8a5a3e353c antes y después)
```

### 1.4 El endpoint ya es multiusuario, y ya es genérico

`POST /api/admin/import-plan` acepta `user_id` **por id o por nombre exacto** desde el diseño
original. Sin ningún cambio de código se importaron dos planes que no se parecen en nada:

| | Ana (mi plan) | Bruno (plan de prueba) |
|---|---|---|
| Objetivo | fuerza / hipertrofia, 24 semanas | resistencia y pérdida de grasa, 12 semanas |
| Fases | 3 | 2 |
| Progresión | doble progresión | `linear` por defecto, `greyskull_lp` en un ejercicio, `time` en otro, `off` en un día entero |
| Descargas | 6 semanas, −40 % | ninguna en el bloque 1, una al 50 % en el 2 |
| Cardio | 4 bloques | 3 bloques, uno de 90 min a 22 km/h |
| Bloque postural | sí, los 7 días | **no** (`schedule_postural_on_rest_days: false`) |
| Resultado | 23 rutinas, 58 del catálogo, 8 propios | 6 rutinas, 8 del catálogo, 6 propios |

También se ejercitaron sin problema `active_phase` numérico (`0`), `emit_deload_routines: false`,
`per_side`, `increment_kg`, `speed` y `pattern`. **La tubería de escritura no tiene ninguna
limitación oculta**: acepta un plan de fuerza para uno y uno de resistencia para otro tal cual.

---

## 2. Riesgos reales, que conviene decidir antes de dar de alta a nadie

### 2.1 🔴 El registro está abierto y **no te enterarías**

`GET /api/config` responde hoy `{"invite_only":false,"allow_guest":true}`. Cualquiera con la URL
pulsa *Create new profile*, pone un nombre y crea una cuenta con su passkey. No hace falta ninguna
credencial previa.

Los hechos sobre si te enterarías:

* **Sí queda registrado.** `data/audit.log` recibe una línea por alta:
  `{"id":7,"ts":1788351887463,"ev":"auth.register.ok","ok":true,"uid":"3TR-…","name":"Alberto","ip":"192.168.112.0/24"}`.
* **No hay ninguna notificación.** Ni push, ni correo, ni nada. El código no tiene ningún aviso
  al operador por un alta nueva.
* **No hay panel donde mirarlo.** `ADMIN_UIDS` está **vacío** en tu `.env` (verificado dentro del
  contenedor: `ADMIN_UIDS=[]`), así que `/api/admin/users` responde `401` incluso para ti y el
  enlace *Admin dashboard* no aparece en Ajustes.
* → **Hoy sólo te enterarías entrando por SSH** a mirar `data/db.json` o `data/audit.log`.
* **Y el `ip` del log no sirve para distinguir a nadie.** Ver §2.3.

Mientras seas el único usuario esto es teórico: nadie conoce la URL. En cuanto la compartas con
varias personas, el subdominio deja de ser secreto (historiales de navegador, mensajes reenviados,
certificate transparency — `gym.albertoalbaladejo.com` es público desde que Certbot emitió el
certificado, y ese log lo rastrean bots).

### 2.2 🟡 Sí se puede cerrar el registro **sin escribir código**

Existe entero en upstream y no está activado:

```bash
# .env
ADMIN_UIDS=3TR-nhgjg3tPyw4R    # tu uid, de data/db.json
INVITE_ONLY=1
ALLOW_GUEST=0                  # opcional: quita "Continuar sin cuenta"
```

Qué te da, tras `docker compose up -d api`:

* `ADMIN_UIDS` → el enlace **Admin dashboard** en Ajustes, y con él `GET /api/admin/users`
  (lista de perfiles con nº de entrenos, último sync, estado push y presencia en vivo),
  `GET /api/admin/user` (historial y peso de uno), `POST /api/admin/user/disable`
  (desactivar/reactivar) y `GET /api/admin/audit` (el log, paginado, desde el móvil).
* `INVITE_ONLY=1` → `POST /api/register/verify` exige un código válido no usado ni revocado
  (`api/server.js:628` y `:677`). Los códigos se acuñan desde el panel
  (`POST /api/admin/invites/new`): 16 caracteres hex, un solo uso, revocables, y quedan asociados
  al perfil que los gastó (`user.invitedBy`).
* **Las cuentas que ya existen siguen funcionando.** `INVITE_ONLY` sólo mira el alta.

Coste: 3 líneas en `.env` y un reinicio del contenedor `api`. **Cero código.** Es la palanca de
mayor efecto que hay en todo este documento.

Lo que **no** existe y habría que construir: límite de nº de perfiles, aprobación manual
(alta pendiente hasta que la apruebas), y caducidad de los códigos de invitación.

### 2.3 🔴 El *rate limit* del import es **global**, no por usuario

Esto no es teórico: se midió. Con `IMPORT_RATE_MAX=4`:

```
5 peticiones para Ana con clave mala   → 401 429 429 429 429
1 petición legítima para BRUNO, mismo origen → 429   ← Bruno bloqueado por lo que gastó Ana
la misma petición desde otra IP de origen    → 200
```

La causa está en la clave del contador (`api/server.js`):

```js
const peerKey = req => req.socket?.remoteAddress || 'unknown';
```

Es **la dirección de origen del socket, no el usuario**. Y aquí está el agravante en producción:

```
$ docker network inspect opengym_default
opengym-web-1  192.168.112.2/20
opengym-api-1  192.168.112.3/20
```

La `api` sólo recibe conexiones del contenedor `web`. **Para el contador, todo internet es un
único cliente: `192.168.112.2`.** Con el valor por defecto son **10 imports cada 5 minutos para
toda la instancia**, sin importar cuántos perfiles haya ni quién los pida.

Con un solo usuario da igual. Con cinco, un script mal configurado —o un intento de adivinar la
clave desde fuera— deja a todos los demás sin poder importar durante la ventana. **Y `expected_ts`
/ `state_ts` sí son estrictamente por perfil** (se leen de `state-<uid>.json`), así que la
concurrencia está bien resuelta y sólo el contador está mal repartido.

### 2.4 🟡 `IMPORT_API_KEY` es una llave maestra

Una sola clave, escritura total sobre el plan de **cualquier** perfil de la instancia. Hoy es
correcto: tú eres el único que importa, para todos. Deja de serlo el día que quieras que otra
persona (o su LLM) importe su propio plan sin poder tocar el tuyo.

Análisis, sin implementar nada:

| Esquema | A favor | En contra |
|---|---|---|
| **Clave única global** (hoy) | Cero estado nuevo. Correcto mientras el operador sea el único importador. | Nadie más puede importar sin poder escribir en todos los perfiles. Rotarla obliga a reconfigurar a todos. |
| **Clave por usuario** (`data/tokens.json`, `{token, uid, created, label}`) | Cada quien escribe sólo lo suyo; revocar una no afecta a las demás; el `user_id` deja de ser un parámetro de confianza y pasa a deducirse del token. | Fichero de estado nuevo, y una forma de acuñarlas — que naturalmente es el panel de admin del §2.2. Es exactamente lo que el roadmap del MCP ya preveía (`mcp/README.md`, Fase 2). |
| **Clave global + `allowed_uids`** | Punto medio barato. | Sigue siendo una clave; comprometerla las compromete todas. |

Recomendación **si y sólo si** decides que otros importen sus propios planes: clave por usuario,
acuñada desde el panel, y `user_id` deducido del token en vez de leído del payload. Si los planes
los sigues importando tú para todos, la clave única global es la respuesta correcta y no hay nada
que hacer.

### 2.5 🟡 El log de actividad no distingue a nadie por IP

Comprobado el recorrido completo: el `nginx` del contenedor `web` **sobrescribe** la cabecera
(`web/nginx.conf.template:31`):

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Como el nginx del host hace `proxy_pass` a `127.0.0.1:8090`, ese `$remote_addr` es la puerta del
puente Docker, no la persona. Por eso **todas** las líneas del log real dicen lo mismo:

```json
{"ev":"auth.register.ok","uid":"3TR-nhgjg3tPyw4R","name":"Alberto","ip":"192.168.112.0/24"}
```

Con un usuario da igual. Con varios, la columna `ip` no ayuda a responder "¿quién se registró?" o
"¿de dónde vino ese intento fallido?" — sólo el `uid` y el `name` sirven, y en un alta desconocida
el `name` lo pone el propio desconocido. Se arregla con `set_real_ip_from` + `real_ip_header` en el
nginx del contenedor, pero **es un cambio, no un ajuste**.

### 2.6 🟢 Lo que NO es un riesgo, para que no ocupe sitio

* **Las passkeys ya aíslan bien.** La cookie va firmada con HMAC sobre `uid:expiry:version` y toda
  ruta de datos resuelve el usuario de la sesión, nunca de un parámetro. Un usuario no puede pedir
  el estado de otro.
* **`ALLOW_GUEST=true` no ensucia nada.** El modo invitado se queda entero en el navegador y no
  llega nunca al servidor.
* **El catálogo de ejercicios no es escribible.** Es código dentro de la imagen.
* **Las claves push (VAPID) son de la instancia**, y `db.subs` guarda la suscripción con su `uid`;
  no hay mezcla de notificaciones.

---

## 3. Lo que la generación de planes sí necesitaría, y no es el endpoint

El contrato de `docs/IMPORT_API.md` es genérico (§1.4). Lo que **no** es genérico es la capa de
nombres en español, y conviene saberlo antes de generar planes para otros objetivos.

`api/exercise-aliases.js` se escribió mirando **un** plan de fuerza. Con el plan de resistencia de
prueba, 6 de 14 ejercicios cayeron a "propio" — y **la mitad de ellos sí existen en el catálogo**:

| Nombre en español | ¿Está en el dataset? | Qué pasó |
|---|---|---|
| Sentadilla goblet con mancuerna | **sí** — `1760 dumbbell goblet squat` | cayó a custom |
| Saltos a cajón | **sí** — `1374 box jump down with one leg stabilization` | cayó a custom |
| Press militar con barra | **sí** — `1456 barbell standing close grip military press` | cayó a custom |
| carrera / carrera continua | no hay "running" como tal | custom correcto, pero con `bp: full body` en vez de `cardio` |
| Plancha frontal | no hay plancha simple | custom correcto (decisión deliberada) |

No rompe nada — la creación de ejercicios propios es precisamente la red de seguridad — pero un
ejercicio propio no tiene imagen, ni GIF, ni datos musculares, así que el mapa muscular y las
estadísticas quedan más pobres. Para planes de resistencia, movilidad o pérdida de grasa habría
que ampliar la tabla de alias y las reglas de `bodyPartFor()` (por ejemplo, `carrera` → `cardio`).

Sobre progresiones y descargas: **son genéricas de verdad**. `policyFor()` resuelve
`ejercicio → rutina → modo`, y `POLICIES_FOR` ya limita por modo (`time` sólo admite `off`/`time`,
`cardio` sólo `off`). El plan de Bruno mezcló `linear`, `greyskull`, `time` y `off` en el mismo
import sin un solo aviso. Las descargas se generan de `deload_weeks` + `deload_volume_reduction`
del payload, sin nada cableado: el bloque 1 de Bruno no tenía ninguna y el 2 tenía una al 50 %.

**Lo único con un sesgo implícito hacia "mi" plan es la tabla de alias en español**, no el motor.

---

## 4. Resumen: qué haría falta según el flujo que elijas

Nada de esto está construido. `ADMIN_UIDS` + `INVITE_ONLY` (fila 1) es lo único que ya existe y
sólo requiere `.env`.

| | **A — Alta manual** (tú creas el plan por chat, como el tuyo) | **B — Semi-automático** (cuestionario → LLM → import) | **C — Autoservicio** (cada uno importa lo suyo) |
|---|---|---|---|
| **Cerrar el registro** | `ADMIN_UIDS` + `INVITE_ONLY=1` en `.env`. **Ya existe** | igual | igual |
| **Ver los perfiles** | el panel de admin que activa `ADMIN_UIDS`. **Ya existe** | igual | igual |
| **Importar planes** | el endpoint tal cual, con `--user`. **Ya funciona** | igual | **clave por usuario** (`data/tokens.json` + acuñado desde el panel) |
| **`IMPORT_API_KEY`** | única global, correcta | única global, correcta | por usuario, `user_id` deducido del token |
| **Rate limit** | sirve como está | **arreglar §2.3** (clavar el contador al `uid`, no al socket) | **imprescindible arreglarlo** |
| **Alias en español** | ampliar según los objetivos que aparezcan (§3) | ampliar, y además dar al LLM `max_custom_exercises` + `did_you_mean` (`LLM_INTEGRATION.md` §6.3) | igual que B |
| **Cuestionario / generación** | ninguno: lo haces tú | **todo por construir** — es la decisión de producto que queda | igual que B, más UI |
| **Aviso de alta nueva** | mirar el panel de vez en cuando | ídem, o construir un push al admin | push al admin recomendado |
| **IP real en el log** | no hace falta | conveniente | **recomendable** (§2.5) |
| **Trabajo nuevo total** | **prácticamente cero** — 3 líneas de `.env` | rate limit + alias + el generador | rate limit + alias + tokens + generador + UI |

### Lo que yo haría hoy, decidas lo que decidas

Poner `ADMIN_UIDS` e `INVITE_ONLY=1` **antes** de compartir la URL con nadie. Es un ajuste de
`.env`, no toca código, no rompe tu cuenta, y convierte "cualquiera con la URL entra" en "sólo
quien tenga un código que has generado tú". Todo lo demás puede esperar a que decidas el flujo.
