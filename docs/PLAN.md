# Plan: cuentas, listas personalizadas y familias

Estado: **en desarrollo**. Etapas 0A y 0 completadas. Siguiente: Etapa 1 (login con Google).

## 1. Objetivo

Pasar de un modelo "código familiar = acceso a todo" a un modelo basado en **cuentas de usuario**:

- Cada persona inicia sesión con Google.
- En su espacio personal puede crear, gestionar y ordenar **listas a demanda**.
- Puede pertenecer a **varias familias**, cada una con su propio contenido (listas compartidas, calendario, ubicaciones, productos aprendidos).
- Se entra a una familia o a una lista mediante **invitaciones** que se pueden **aceptar o rechazar**.
- Una lista puede ser personal, de una familia, y además **compartirse con personas puntuales**.
- Los datos actuales (familia `CASA`, etc.) se **migran** y se reclaman.

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Login | Solo Google (OAuth / Google Identity Services). Sin contraseñas ni envío de correos. |
| Sesión | Cookie httpOnly con token opaco guardado (hash) en tabla `sessions`. No JWT. |
| Invitado | Estado de una invitación (pendiente → aceptada / rechazada). No es un modo sin cuenta. |
| Familias | Un usuario puede pertenecer a varias; cada una con su propio contenido. |
| Compartir listas | Dueño = usuario **o** familia, y además compartible con usuarios puntuales (`list_members`). |
| Datos actuales | Se migran; el primer usuario que ingresa el código antiguo reclama la familia como `owner`. |
| Notificaciones | Dentro de la app (bandeja de invitaciones + tiempo real). Email queda como extra futuro. |
| Hosting | Vercel (frontend estático + API como función serverless). Se abandona Render por el cold start. |
| Tiempo real | Ably (canales privados con token). Reemplaza Socket.IO, que no funciona en serverless. |
| Base de datos | Turso (sin cambios). |

## 3. Conceptos y reglas

- **Usuario**: identificado por su cuenta Google (`google_sub`) y email.
- **Espacio personal**: listas cuyo dueño es el usuario + listas compartidas con él.
- **Familia**: grupo con roles `owner`, `admin`, `member`.
  - Siempre debe tener al menos un `owner`.
  - `owner`/`admin` invitan, quitan miembros y gestionan la familia; `member` usa y crea listas de la familia.
  - Solo `owner` puede borrar la familia o transferir la propiedad.
- **Lista**: pertenece a exactamente **un** dueño (`owner_user_id` XOR `family_id`).
  - Tipos: `shopping` (ubicación + sugerencias), `tasks` (responsable + ubicación), `checklist` (solo título).
  - Se puede compartir con usuarios puntuales con permiso `editor` o `viewer`.
  - Una lista personal se puede **mover** a una familia de la que el dueño es miembro (y viceversa, por `owner`/`admin` de la familia).
- **Invitación**: a una familia (con rol ofrecido) o a una lista (con permiso ofrecido), dirigida a un **email**.
  - Si el email aún no tiene cuenta, la invitación queda esperando y aparece en su primer login.
  - Estados: `pending`, `accepted`, `declined`, `revoked`, `expired`. Vencen a los 7 días.
  - No se puede invitar a quien ya es miembro; reinvitar reemplaza la pendiente.

### Matriz de permisos sobre una lista

`listAccess(user, list)` devuelve el nivel más alto que aplique:

| Condición | Nivel |
|---|---|
| `list.owner_user_id = user.id` | `owner` |
| Lista de familia y usuario es `owner`/`admin` de esa familia | `owner` |
| Lista de familia y usuario es `member` | `editor` |
| Usuario está en `list_members` con `editor` | `editor` |
| Usuario está en `list_members` con `viewer` | `viewer` |
| Ninguna | `none` (responder 404, no 403, para no revelar existencia) |

| Acción | viewer | editor | owner |
|---|:-:|:-:|:-:|
| Ver lista e ítems | ✓ | ✓ | ✓ |
| Crear / editar / completar / reordenar / borrar ítems | | ✓ | ✓ |
| Renombrar, ícono, color, tipo, orden por defecto | | | ✓ |
| Compartir / quitar personas, invitar | | | ✓ |
| Mover, archivar, borrar la lista | | | ✓ |
| Dejar de ver una lista compartida conmigo | ✓ | ✓ | — |

## 4. Modelo de datos (libSQL / Turso)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,           -- normalizado a minúsculas
  name TEXT NOT NULL,
  avatar_url TEXT,
  color TEXT NOT NULL,                  -- para avatar/inicial
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                  -- sha256 del token de la cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,             -- 60 días, renovación deslizante
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);

-- families: se mantiene; se agregan columnas
ALTER TABLE families ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE families ADD COLUMN legacy_code_claimed_at TEXT;  -- migración

CREATE TABLE family_members (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (family_id, user_id)
);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('shopping','tasks','checklist')),
  icon TEXT NOT NULL DEFAULT 'list',
  color TEXT NOT NULL DEFAULT 'green',
  default_sort TEXT NOT NULL DEFAULT 'custom' CHECK (default_sort IN ('custom','alpha')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((owner_user_id IS NULL) <> (family_id IS NULL))
);

CREATE TABLE list_members (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('editor','viewer')),
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, user_id)
);

CREATE TABLE user_list_prefs (          -- orden y visibilidad en el menú de cada usuario
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  sort_override TEXT,                   -- reemplaza el localStorage actual
  PRIMARY KEY (user_id, list_id)
);

CREATE TABLE list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  legacy_assignee TEXT,                 -- "Matías"/"Francisca" hasta vincular
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT
);
CREATE INDEX idx_list_items_list ON list_items(list_id, completed, archived_at);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,      -- para el enlace /invitacion/:token
  kind TEXT NOT NULL CHECK (kind IN ('family','list')),
  family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
  list_id TEXT REFERENCES lists(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,          -- normalizado
  offered_role TEXT NOT NULL,           -- admin|member (family) o editor|viewer (list)
  invited_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  responded_by TEXT REFERENCES users(id),
  CHECK ((kind = 'family' AND family_id IS NOT NULL AND list_id IS NULL)
      OR (kind = 'list' AND list_id IS NOT NULL AND family_id IS NULL))
);
CREATE INDEX idx_invitations_email ON invitations(invited_email, status);
```

**Cambios en tablas existentes**

- `locations`: agregar `owner_user_id` (nullable) y hacer `family_id` nullable, con el mismo CHECK XOR que `lists`. Una lista usa las ubicaciones de su dueño.
- `learned_products`: pasar a clave `(scope_id, name_key)` donde `scope_id` es el `family_id` o `user:<id>`.
- `calendar_entries`: se mantienen por familia; agregar `created_by`.
- `shopping_items` y `household_tasks`: quedan de solo lectura tras la migración y se eliminan en una versión posterior.

**Nota libSQL**: SQLite no permite quitar `NOT NULL` con `ALTER TABLE`; para `locations` y `learned_products` se hace el patrón "crear tabla nueva → copiar → renombrar" dentro de una transacción.

## 5. Autenticación

- **Flujo**: Google Identity Services en el cliente → obtiene `credential` (ID token) → `POST /api/auth/google` → el servidor verifica firma, `aud` = Client ID, `iss`, `exp` y `email_verified` (librería `google-auth-library`) → crea o actualiza `users` → crea `sessions` → responde con cookie.
- **Cookie**: `sid`, httpOnly, `Secure` en producción, `SameSite=Lax`, `Path=/`, 60 días, renovación deslizante (si `last_seen_at` tiene más de 1 día).
- **CSRF**: `SameSite=Lax` + la API solo acepta `application/json` + se verifica el header `Origin` en métodos de escritura.
- **Middleware** `requireUser`: lee la cookie, busca la sesión por hash, adjunta `req.user`; si no hay sesión, 401.
- **Límites**: rate limit en `/api/auth/*` (por IP), en la creación de invitaciones (por usuario/día) y en la aceptación por token.
- **Logout**: borra la sesión actual. "Cerrar sesión en todos los dispositivos": borra todas las del usuario.
- **Variables de entorno nuevas**: `GOOGLE_CLIENT_ID`, `SESSION_SECRET` (opcional, para firmar), `APP_ORIGIN`.
- **Requisito externo**: proyecto en Google Cloud Console con credencial OAuth "Aplicación web"; orígenes autorizados `http://localhost:5173` y la URL de Vercel. Lo configura el dueño del proyecto.

## 6. API

Todas las rutas (salvo `/api/health` y `/api/auth/google`) requieren sesión. Los errores mantienen el formato actual `{ message }` en español.

### Auth y usuario
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/google` | Login con ID token de Google |
| POST | `/api/auth/logout` | Cierra la sesión actual |
| POST | `/api/auth/logout-all` | Cierra todas las sesiones |
| GET | `/api/me` | Arranque: usuario, familias (con rol), listas visibles (metadata, prefs, nivel de acceso), invitaciones pendientes recibidas |
| PATCH | `/api/me` | Nombre visible, color |

### Listas
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/lists` | Crear (`{ id?, name, kind, icon, color, familyId? }`); sin `familyId` = personal |
| GET | `/api/lists/:listId` | Metadata + ítems + miembros compartidos |
| PATCH | `/api/lists/:listId` | Renombrar, ícono, color, orden por defecto, archivar/restaurar |
| POST | `/api/lists/:listId/move` | `{ familyId \| null }` mover entre personal y familia |
| DELETE | `/api/lists/:listId` | Borrar (owner) |
| PUT | `/api/me/list-prefs` | Orden del menú, ocultar, orden preferido por lista |
| DELETE | `/api/lists/:listId/members/me` | Dejar una lista compartida conmigo |
| PATCH/DELETE | `/api/lists/:listId/members/:userId` | Cambiar permiso / quitar persona |

### Ítems
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/lists/:listId/items` | Crear (id opcional para offline, idempotente) |
| PATCH | `/api/lists/:listId/items/:itemId` | Título, completado, ubicación, responsable |
| DELETE | `/api/lists/:listId/items/:itemId` | Borrar |
| POST | `/api/lists/:listId/items/reorder` | `{ ids }` |
| GET | `/api/lists/:listId/suggestions?q=` | Solo `shopping`: catálogo + productos aprendidos del dueño |

### Familias
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/families` | Crear (el creador queda `owner`) |
| GET | `/api/families/:id` | Metadata, miembros, ubicaciones |
| PATCH | `/api/families/:id` | Renombrar (owner/admin) |
| DELETE | `/api/families/:id` | Borrar (owner) |
| PATCH | `/api/families/:id/members/:userId` | Cambiar rol (owner; admin no puede tocar owners) |
| DELETE | `/api/families/:id/members/:userId` | Quitar miembro / salir (`me`) |
| POST | `/api/families/:id/transfer` | Transferir propiedad |
| CRUD | `/api/families/:id/locations` | Igual que hoy, con permisos |
| CRUD | `/api/families/:id/calendar` | Igual que hoy, con permisos |
| POST | `/api/families/claim` | `{ code }` reclamar familia antigua (migración) |

### Invitaciones
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/families/:id/invitations` | `{ email, role }` → devuelve enlace |
| POST | `/api/lists/:listId/invitations` | `{ email, permission }` → devuelve enlace |
| GET | `/api/families/:id/invitations` · `/api/lists/:listId/invitations` | Pendientes enviadas (para revocar/reenviar) |
| DELETE | `/api/invitations/:id` | Revocar (quien invita / owner) |
| GET | `/api/invitations` | Recibidas pendientes |
| GET | `/api/invitations/token/:token` | Vista previa por enlace (quién, a qué); requiere login |
| POST | `/api/invitations/:id/accept` · `/decline` | Responder. Acepta si el email coincide; por enlace, el token también autoriza |

**Regla del enlace**: el enlace lo puede aceptar cualquier usuario autenticado que lo tenga (útil si la persona usa otro email de Google), pero es de un solo uso y vence. Se muestra claramente a qué email iba dirigido.

## 7. Tiempo real (Ably)

Vercel ejecuta la API como funciones serverless, que no mantienen WebSockets. El tiempo real lo entrega **Ably**.

- **Patrón "aviso + recarga"**: el servidor publica mensajes pequeños que solo dicen *qué cambió*; el cliente vuelve a pedir los datos a la API, que es la única que decide qué puede ver cada uno. Evita el límite de tamaño de mensaje y no duplica la lógica de permisos.
- **Publicación**: desde la API con `Ably.Rest` (clave `ABLY_API_KEY`, solo en el servidor), después de cada escritura exitosa.
- **Suscripción**: el cliente usa `Ably.Realtime` con `authUrl: /api/realtime/token`. El servidor emite un *token request* cuyas `capability` solo incluyen los canales permitidos (`subscribe`), p. ej.:
  ```json
  { "user:<id>": ["subscribe"], "family:<fid>": ["subscribe"], "list:<lid>": ["subscribe"] }
  ```
  Así un cliente no puede escuchar canales ajenos ni publicar.
- **Cambios de membresía** (aceptar, quitar, salir): se publica `me:updated` en `user:<id>`; el cliente pide un token nuevo (`auth.authorize()`) para obtener las capabilities actualizadas y se suscribe/desuscribe.
- **Canales**: `user:<id>`, `family:<id>`, `list:<id>`.
- **Mensajes** (nombre + datos mínimos):
  - `me:updated`: cambió algo del arranque (listas visibles, familias, invitaciones)
  - `list:changed` `{ listId }`: metadata o ítems → `GET /api/lists/:id`
  - `list:removed` `{ listId }`: perdiste acceso o se borró
  - `family:changed` `{ familyId }`: miembros, ubicaciones
  - `calendar:changed` `{ familyId }`
  - `invitation:changed`
- **Emisión**: a `family:<id>` si la lista es de familia, más `list:<id>` (compartida puntualmente) y `user:<owner>` según corresponda.
- **Reconexión**: al recuperar conexión (`connection.on("connected")`) el cliente vacía su cola offline y recarga lo visible, como hoy.
- **Antes del login (Etapa 0A)**: el token se emite por código de familia con capability solo sobre `family:<código>`.

## 8. Cliente

### Estructura (dividir `src/App.tsx`, hoy ~2400 líneas)
```
src/
  main.tsx, router.tsx
  api/            client.ts (fetch + ApiError), socket.ts
  auth/           AuthProvider.tsx, LoginPage.tsx, useSession.ts
  offline/        db.ts (idb), queue.ts
  spaces/         SpaceSwitcher.tsx, Sidebar.tsx
  lists/          ListPage.tsx, ListItemRow.tsx, NewListModal.tsx, ListSettings.tsx, ShareListModal.tsx
  families/       FamilyPage.tsx, MembersPanel.tsx, InviteModal.tsx, ClaimFamily.tsx
  invitations/    InvitationsInbox.tsx, InvitationLanding.tsx
  calendar/       CalendarSection.tsx (movido tal cual)
  components/     SwipeCard, SortChips, DragList, Modal…  (movidos tal cual)
```

### Rutas (`react-router`)
| Ruta | Pantalla |
|---|---|
| `/login` | Botón "Entrar con Google" |
| `/` | Redirige a la última lista abierta o al espacio personal |
| `/personal` | Mis listas + "Compartidas conmigo" |
| `/familias/:id` | Listas de la familia |
| `/familias/:id/calendario` | Calendario de la familia |
| `/familias/:id/ajustes` | Miembros, roles, invitaciones enviadas, ubicaciones |
| `/listas/:id` | Una lista |
| `/invitaciones` | Bandeja recibida |
| `/invitacion/:token` | Aterrizaje de enlace (login si hace falta → aceptar/rechazar) |
| `/cuenta` | Perfil, cerrar sesión, cerrar en todos lados |

### Interfaz
- **Selector de espacio** (header en escritorio, hoja inferior en móvil): Personal · Familia A · Familia B · "+ Crear familia".
- **Sidebar** por espacio: listas ordenables (drag), badge de pendientes, "+ Nueva lista", y en familias "Calendario" y "Ajustes".
- **Nueva lista**: nombre, tipo (compras / tareas / checklist), ícono, color, dueño (personal o una familia).
- **Menú de lista**: renombrar, ícono/color, compartir, mover, archivar, borrar (con confirmación que indica cuántos ítems se pierden). "Archivadas" al final del sidebar.
- **Compartir lista**: email + permiso, lista de personas con acceso, invitaciones pendientes revocables, copiar enlace.
- **Bandeja de invitaciones**: campana con contador en el header; cada tarjeta muestra quién invita, a qué, el rol ofrecido, "Aceptar" / "Rechazar".
- **Primer ingreso** sin nada: pantalla vacía con tres acciones: "Crear mi primera lista", "Crear una familia", "Tengo un código antiguo" (reclamar).
- **Responsable** en tareas: selector con los miembros reales de la familia (o de la lista compartida); reemplaza los nombres fijos "Matías"/"Francisca".
- Se reutilizan: swipe para editar/borrar, drag para reordenar, orden alfabético, sugerencias, capitalización, ubicaciones.

### Offline
- IndexedDB versión 2 (`casa-offline`):
  - `session`: usuario y `/api/me` en caché
  - `lists`: metadata + ítems por lista
  - `outbox`: se agrega `userId`; la cola se procesa solo para el usuario activo
- Funcionan offline: crear/editar/completar/reordenar/borrar ítems, crear listas personales (id generado en cliente).
- Requieren conexión: login, invitaciones, gestión de miembros, mover listas, crear familias. Se muestra el botón deshabilitado con aviso.
- Si la cola recibe 401: se pausa, se conserva, se pide login y se reanuda con el mismo usuario (si cambia de usuario, se descarta con aviso).
- Si recibe 404 (se perdió acceso): se descarta la operación, como hoy.
- Logout borra la caché y la cola del usuario en el dispositivo.

## 9. Migración de datos actuales

Se ejecuta en `initialize()` de forma idempotente (marcada con una tabla `migrations(name, applied_at)`).

1. Crear tablas nuevas.
2. Por cada familia existente:
   - Crear lista `Compras` (`shopping`) y `Por hacer` (`tasks`) con `family_id`.
   - Copiar `shopping_items` → `list_items` (mismo `id`, `position`, fechas, `location_id`).
   - Copiar `household_tasks` → `list_items` con `legacy_assignee` = assignee de texto.
   - `created_by` de las listas: usuario de sistema `system` hasta que se reclame.
3. Pasar `locations` y `learned_products` al nuevo esquema.
4. Familias sin `family_members` quedan **sin reclamar**.

**Reclamar**: `POST /api/families/claim { code }`. Si la familia existe y no tiene miembros, el usuario queda `owner`, se marca `legacy_code_claimed_at` y el código deja de servir. Si ya fue reclamada, se responde "Esta familia ya tiene dueño; pide una invitación".

**Vincular responsables**: en Ajustes de la familia, el owner ve los nombres antiguos ("Matías", "Francisca") y los asocia a miembros reales; se actualiza `assignee_user_id` y se limpia `legacy_assignee`.

**Retiro del modelo antiguo**:
- Durante las etapas 1–6 las rutas `/api/families/:id/items|tasks` antiguas siguen activas (para no romper producción).
- En la etapa 7 se eliminan las rutas antiguas, el onboarding por código y `?familia=` en la URL.
- Las tablas `shopping_items` y `household_tasks` se borran en una versión posterior, tras verificar la migración. Antes, respaldo de Turso (`turso db shell … .dump`).
- La familia de prueba `CASA` deja de crearse automáticamente.

## 10. Etapas

Cada etapa: rama `feature/<nombre>`, PR propio, desplegable sin romper la anterior.

### Etapa 0A: Migración a Vercel + Ably ✅
Motivo: Render free apaga el servidor tras ~15 min sin tráfico y el arranque tarda 30–60 s.
- **API serverless**: separar `server/app.ts` (Express sin `listen`) de `server/index.ts` (servidor local). `api/index.ts` exporta `app` para Vercel.
- **Migraciones fuera del arranque**: `initialize()` pasa a `npm run db:migrate` (script idempotente), que se ejecuta en el build de Vercel. En las funciones solo se abre el cliente de Turso.
- **Tiempo real**: `server/realtime.ts` publica con `Ably.Rest` (patrón aviso + recarga, §7). `GET /api/families/:id/realtime-token` entrega un token request con capability `subscribe` solo sobre `family:<id>`. El cliente reemplaza `socket.io-client` por `ably`.
- **Vercel**: `vercel.json` con build de Vite (`dist`), rewrites `/api/*` → función y el resto → `index.html`.
- **Desarrollo local**: se mantiene `npm run dev` (Express + Vite); sin `ABLY_API_KEY` el tiempo real queda desactivado sin romper nada.
- **Variables de entorno**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ABLY_API_KEY`.
- Se eliminan `socket.io`, `socket.io-client` y `render.yaml` (tras verificar Vercel).
- En previews sin `TURSO_DATABASE_URL` el build omite las migraciones (`server/init-database.ts`).
- **Requisito externo**: cuenta de Vercel conectada al repo de GitHub y app de Ably con una API key (permisos publish + subscribe).
- **Listo cuando**: la app corre en Vercel sin cold start perceptible, dos dispositivos se sincronizan en tiempo real y el modo offline sigue funcionando.

### Etapa 0: Preparación ✅
- Dividir `App.tsx` según la estructura de §8 sin cambiar comportamiento.
- Dividir `server/index.ts` en routers (`routes/items.ts`, `routes/tasks.ts`, …) y `HomeRepository` por dominio.
- Agregar `react-router`.
- Agregar `vitest` + `supertest`; base de datos libSQL en memoria (`file::memory:`) para tests.
- Tests de humo de la API actual.
- **Listo cuando**: la app se comporta igual y `npm test` pasa.
- **Resultado**:
  - Servidor: `server/app.ts` monta routers por dominio (`server/routes/`), con validaciones en `server/http/` y acceso a datos en `server/db/` (un módulo por dominio + `migrations.ts`).
  - Cliente: `src/App.tsx` solo orquesta sesión, sincronización y tiempo real; el resto vive en `api/`, `lib/`, `hooks/`, `components/`, `onboarding/`, `family/`, `shopping/`, `tasks/` y `calendar/`.
  - Las secciones tienen URL propia (`/`, `/tareas`, `/calendario`) con `react-router`; funcionan el botón atrás y recargar.
  - `npm test`: tests de API con base libSQL temporal (`server/app.test.ts`) y unitarios de orden de listas y calendario (`src/lib/*.test.ts`).
  - Ajuste: la gestión de ubicaciones recarga la familia al guardar, sin depender del tiempo real.

### Etapa 1: Login con Google
- Tablas `users`, `sessions`; `google-auth-library`; middleware `requireUser`.
- `POST /api/auth/google`, `logout`, `logout-all`, `GET/PATCH /api/me`.
- `LoginPage`, `AuthProvider`, guardas de ruta.
- Token de Ably (`/api/realtime/token`) emitido según la sesión, con canal `user:<id>`.
- Convivencia: tras login, si el usuario no tiene nada, se ofrece "Tengo un código antiguo" (usa aún el flujo viejo).
- **Tests**: token inválido / aud incorrecto / email no verificado → 401; sesión vencida → 401; renovación deslizante.
- **Listo cuando**: se puede entrar y salir con Google en local y en Vercel.
- **Resultado** (rama `feature/etapa-1-login`):
  - Tablas `users` y `sessions` (token opaco; en la base solo su hash SHA-256; 60 días con renovación deslizante diaria).
  - `server/auth/google.ts` verifica el ID token (`google-auth-library`, exige `email_verified`). `GET /api/auth/config` entrega el Client ID al cliente, así no se necesita en el build.
  - Toda la API salvo `/api/health` y `/api/auth/*` exige sesión, incluidas las rutas antiguas de familia (convivencia hasta la Etapa 7).
  - Seguridad: cookie `sid` httpOnly + `SameSite=Lax` (+ `Secure` en HTTPS), escrituras con `Origin` distinto al `Host` → 403, límite de 30 intentos de login cada 10 min por IP. Se quitó `cors`.
  - Cliente: `AuthProvider` + `LoginPage` (Google Identity Services) + menú de cuenta en la cabecera (salir de la familia, cerrar sesión, cerrar en todos lados; también accesible en móvil).
  - Sesión vencida (401): se pide login pero se conserva la cola offline; cerrar sesión o entrar con otra cuenta borra los datos del dispositivo.
  - Desarrollo local sin Google: `AUTH_DEV_LOGIN=1` habilita `POST /api/auth/dev` (nunca en Vercel).
  - El token de Ably sigue siendo por familia; el canal `user:<id>` se agrega cuando haga falta (Etapa 4).
  - Pendiente del dueño: crear la credencial OAuth y cargar `GOOGLE_CLIENT_ID` en Vercel.

### Etapa 2: Listas personales
- Tablas `lists`, `list_items`, `user_list_prefs`; `listAccess()`.
- API de listas e ítems (§6), reorder, archivado de completados por lista (misma regla actual: 5 últimos en 24 h).
- UI: espacio Personal, sidebar dinámico, Nueva lista, ajustes de lista, `ListPage` genérica por tipo.
- Ubicaciones y productos aprendidos personales.
- Offline de listas personales.
- **Tests**: matriz de permisos (§3) para owner/none; idempotencia con id del cliente; reorder solo de pendientes.
- **Listo cuando**: un usuario sin familia usa listas de compras, tareas y checklist, incluso sin conexión.
- **Resultado** (rama `feature/etapa-2-listas`):
  - Tablas `lists`, `list_items`, `user_list_prefs`, `places` y `learned_names`. Cambios respecto del §4:
    - Ubicaciones en `places` (nueva) en vez de modificar `locations`: reconstruir `locations` con claves foráneas activas pondría en null las ubicaciones de todos los ítems existentes. `locations` se migra a `places` al migrar las familias.
    - Productos aprendidos en `learned_names` con `scope` = `user:<id>` / `family:<id>`.
    - El orden de los ítems (personalizado/alfabético) es preferencia de cada usuario en `user_list_prefs.sort`; no hay `default_sort` en `lists`.
  - Borrados explícitos de dependencias (ítems, preferencias, ubicaciones en ítems): no se depende de `ON DELETE` porque `PRAGMA foreign_keys` es por conexión y en Vercel no se garantiza.
  - `listAccess()` en `server/auth/access.ts` (hoy solo dueño); middleware `loadList` responde 404 sin acceso.
  - Tiempo real: `GET /api/realtime/token?family=` entrega un token con `user:<id>` (+ la familia actual). Cambios de listas avisan `me:changed { listId }` en el canal del usuario.
  - Cliente: cola offline global (`src/data/sync.ts`), `MeProvider`, `ConnectionProvider`, `LegacyFamilyProvider`, `AppShell` con menú lateral (listas reordenables, archivadas, familia) y en móvil barra inferior + cajón "Menú". Rutas `/personal`, `/listas/:id`, `/familia`, `/familia/tareas`, `/familia/calendario`, `/familia/unirse`.
  - `ListPage` genérica por tipo; ajustes de lista (nombre, ícono, color, orden, ubicaciones, archivar, eliminar con confirmación).
  - **Decisión para la Etapa 3**: migrar ahí mismo las familias por código a listas (adelantando parte de la Etapa 7), para no mantener dos modelos de familia en paralelo.

### Etapa 3: Familias
- Tabla `family_members`; crear, renombrar, borrar, salir, transferir, roles.
- Listas de familia; calendario y ubicaciones con permisos.
- Selector de espacio; responsable = miembros reales.
- **Tests**: miembro de familia A no ve nada de familia B; admin no puede quitar al owner; no se puede dejar la familia sin owner.
- **Listo cuando**: un usuario pertenece a 2 familias con contenido independiente.
- **Resultado** (rama `feature/etapa-3-familias`), incluye la migración y el reclamo de la Etapa 7:
  - `family_members` con un único `owner` (se cambia con `POST /transfer`), `admin` y `member`. `requireMember(rol)` responde 404 a quien no es miembro.
  - Permisos: owner/admin → `owner` de las listas de la familia; member → `editor`. Ubicaciones: las gestiona cualquier editor.
  - Responsables: `assignee_user_id` debe ser miembro de la familia y solo aplica a listas de tareas. Al salir alguien, sus tareas quedan sin asignar.
  - Migración idempotente por familia (`families.lists_migrated_at`): `locations` → `places`, `shopping_items` → lista "Compras", `household_tasks` → "Por hacer" (con `legacy_assignee`), `learned_products` → `learned_names`. Mismos ids. Autor: usuario de sistema `system`. Las tablas antiguas quedan como respaldo.
  - Reclamo: `POST /api/families/claim { code }` (una sola vez). Enlaces antiguos `?familia=CODIGO` llevan a `/familias/nueva?codigo=`.
  - Vincular responsables antiguos: `POST /api/families/:id/legacy-assignees`.
  - Se eliminaron las rutas antiguas (`/api/families/:id/items|tasks|locations|suggestions` y la carga de la familia completa) y la familia `CASA` automática.
  - Tiempo real: el token incluye `family:<id>` de todas las familias del usuario; los cambios de listas de familia avisan en el canal de la familia.
  - Cliente: rutas `/familias/nueva`, `/familias/:id`, `/familias/:id/calendario`, `/familias/:id/ajustes`. Menú con un bloque por espacio (Mis listas y cada familia). Tareas de familia con responsable (formulario, filtros, edición).
  - Pendiente para la Etapa 4: invitar personas (hoy solo se entra a una familia creándola o reclamándola).

### Etapa 4: Invitaciones
- Tabla `invitations`; crear, listar, revocar, aceptar, rechazar, vencer (se marca `expired` al consultar).
- Bandeja, campana con contador, `InvitationLanding` para `/invitacion/:token`.
- Invitaciones a emails sin cuenta aparecen en el primer login.
- Mensajes Ably `invitation:changed` y renovación del token (capabilities) al aceptar.
- **Tests**: aceptar dos veces; token vencido/revocado; invitar a quien ya es miembro; email con mayúsculas.
- **Listo cuando**: se invita por email o enlace, y el invitado acepta o rechaza desde su bandeja.
- **Resultado** (rama `feature/etapa-4-invitaciones`):
  - Tabla `invitations` genérica (`family` ahora, `list` en la Etapa 5). Del enlace solo se guarda el hash del token (como las sesiones), así que "reenviar" crea un enlace nuevo y anula el anterior.
  - Invitan owner y admin; solo el owner ofrece el rol admin. Límite de 50 invitaciones por usuario cada 24 h. No se invita a quien ya es miembro.
  - Aceptar/rechazar desde la bandeja exige que el email de la cuenta coincida; desde el enlace vale para cualquier cuenta con sesión, una vez. Respuestas sobre invitaciones cerradas: 410 con el motivo.
  - Tiempo real: se reutiliza `me:changed` (al invitado, si ya tiene cuenta) y `family:changed`; al aceptar cambian las familias del usuario y el cliente pide un token nuevo con el canal de la familia (no hizo falta un mensaje `invitation:*` aparte).
  - Cliente: campana con contador en la cabecera, `/invitaciones` (bandeja), `/invitacion/:token` (el login conserva la URL), y en los ajustes de la familia: invitar, copiar/compartir enlace, reenviar y anular pendientes.

### Etapa 5: Compartir listas con personas puntuales
- Tabla `list_members`; permisos `editor`/`viewer`; invitaciones tipo `list`.
- Sección "Compartidas conmigo"; `ShareListModal`; dejar una lista compartida.
- UI de solo lectura para `viewer` (sin swipe, sin formulario de agregar).
- Mover listas entre personal y familia (conserva `list_members`).
- **Tests**: viewer no puede escribir; quitar a alguien le emite `list:removed`; mover lista cambia quién la ve.
- **Listo cuando**: una lista personal se comparte con alguien de fuera de la familia.
- **Resultado** (rama `feature/etapa-5-compartir`):
  - `list_members` con `editor`/`viewer`. `listAccess()` y `visibleLists()` toman el mayor acceso entre dueño, rol en la familia y compartido directo.
  - Invitaciones tipo `list` con la misma tabla y flujo de la Etapa 4 (`POST /api/lists/:id/invitations { email, permission }`); no se invita a quien ya tiene acceso.
  - Gestión: cambiar permiso y quitar (quien administra la lista), dejar de ver (`DELETE /members/me`).
  - `POST /api/lists/:id/move { familyId | null }`: entre lo personal y una familia propia. Los ítems pierden ubicación y responsable (eran del dueño anterior); lo compartido se mantiene.
  - Tiempo real: se avisa por el canal de cada usuario con acceso (sin canales `list:<id>`).
  - Cliente: espacio "Compartidas conmigo" (`/compartidas`), botón Compartir en cada lista, aviso de solo lectura para lectores, "Mover a" en los ajustes de la lista. `InviteManager` es común a familias y listas.

### Etapa 6: Tiempo real y offline completos
- Canales y mensajes por lista (§7) reemplazando el aviso por familia de la Etapa 0A; token por sesión con capabilities por canal.
- IndexedDB v2, cola por usuario, manejo de 401/404, logout limpia datos.
- **Listo cuando**: dos dispositivos con distintos usuarios ven solo lo suyo en tiempo real, y offline sigue funcionando como hoy.
- **Resultado** (rama `feature/etapa-6-offline`). Lo de canales y cola por usuario se fue armando en las etapas 2–5; esta etapa corrigió la cola y la probó:
  - **Bug corregido**: tras un intento de envío sin conexión, `flushQueue` quedaba con una promesa ya resuelta guardada y no volvía a enviar hasta recargar la página.
  - **Bug corregido**: dos cambios en el mismo milisegundo podían enviarse en orden inverso; ahora la cola usa un número de secuencia (`seq`).
  - **Bug corregido**: lo que se agregaba mientras la cola se enviaba podía quedar esperando; ahora se envía de a una operación releyendo la cola.
  - Rechazos permanentes (400, 403, 409, 410, 422) se descartan en vez de bloquear la cola, y se avisa al usuario; 404 se descarta sin aviso. Red caída, 401, 429 y 5xx detienen el envío y se reintenta cada 30 s, al volver la red o al reconectar Ably.
  - Si entra otra cuenta en el dispositivo, se avisa cuántos cambios pendientes de la anterior se descartaron.
  - Sin tiempo real configurado, el estado vuelve a "Sincronizado" al recuperar la red.
  - Tests de la cola en `src/data/sync.test.ts` (happy-dom + fake-indexeddb).
  - Probado en el navegador: cambios sin conexión, envío al volver, cambio rechazado con aviso y arranque desde la caché con el servidor caído.

### Etapa 7: Migración y retiro del modelo antiguo
- Script de migración (§9) probado primero contra una copia de la base de Turso.
- Reclamar familia y vincular responsables antiguos.
- Quitar onboarding por código, rutas antiguas, familia `CASA` automática.
- Actualizar `README.md` y variables de entorno en Vercel.
- **Listo cuando**: los datos actuales están en listas nuevas, reclamados, y ya no se puede entrar solo con el código.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Filtrar listas personales por tiempo real o `GET` | Toda respuesta pasa por `listAccess`; los mensajes Ably no llevan datos; capabilities del token limitadas a canales permitidos; tests de "usuario ajeno ve 404 / no obtiene el canal" |
| Perder datos en la migración | Respaldo previo, migración idempotente, tablas viejas conservadas, prueba contra copia |
| Límites de planes gratis (Vercel Hobby, Ably Free) | Mensajes mínimos (aviso + recarga); revisar uso mensual; plan pago si se supera |
| Tiempo máximo de funciones serverless | Nada de trabajo largo en requests; migraciones en el build |
| Cookie en PWA iOS (Safari) | Mismo origen para web y API (ya es así en producción); probar instalación en iPhone |
| Cola offline de otro usuario en el mismo dispositivo | Outbox con `userId` y limpieza al cerrar sesión |
| Complejidad de `App.tsx` | Etapa 0 dedicada a dividirlo antes de agregar funciones |
| Abuso de invitaciones | Rate limit por usuario, vencimiento, un solo uso |

## 12. Pendiente de definir más adelante

- Notificaciones por email de invitaciones (Resend u otro).
- Calendario personal y eventos compartidos con personas puntuales.
- Plantillas de listas (por ejemplo "Compras semanales").
- Historial / actividad por lista ("Francisca completó Leche").
- Borrar la cuenta y exportar datos.
