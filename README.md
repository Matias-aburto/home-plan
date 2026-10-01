# Listas (nombre provisorio)

PWA de listas y calendarios, personales o en grupos (familia, amigos, un depto compartido, un viaje), sincronizados en tiempo real y usables sin conexión.

El nombre de la app está en `src/lib/brand.tsx` (y en `index.html` / `vite.config.ts` para la PWA).

## Qué hace

- **Cuentas con Google.** Cada persona entra con su cuenta; la sesión se guarda en una cookie httpOnly.
- **Un botón "Nuevo"** para crear una lista o un calendario, personal o de uno de tus grupos, con nombre, ícono y color.
- **Listas**: un solo tipo, ítems para marcar. Se renombran, archivan, reordenan y eliminan.
- **Calendarios** con eventos y recordatorios (también anuales). Son personales o de un grupo; no se comparten con personas puntuales.
- **Grupos.** Se crean vacíos. Una persona puede estar en varios, cada uno con sus listas, calendarios y roles (dueño, administrador, miembro). Internamente el código y la base siguen llamándolos `family`.
- **Invitaciones** por email o enlace (un solo uso, vencen en 7 días), con bandeja para aceptar o rechazar.
- **Compartir una lista** con personas puntuales, con permiso de edición o solo lectura. Las listas se pueden mover entre lo personal y un grupo.
- **Sin conexión.** Los cambios se guardan en el dispositivo (IndexedDB) y se envían en orden al recuperar la red.

El diseño completo y las decisiones están en [docs/PLAN.md](docs/PLAN.md).

## Desarrollo

```bash
npm install
npm run dev
```

La web queda en `http://localhost:5173` y la API en `http://localhost:3001` (Vite redirige `/api` a la API conservando el `Host`).

Para probar desde un teléfono en la misma red, abre `http://IP-DE-TU-PC:5173`.

Configuración local en `.env` (ver [.env.example](.env.example)); todas las variables son opcionales:

| Variable | Para qué | Sin ella |
|---|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Base de datos Turso | Se usa `data/home-plan.db` |
| `ABLY_API_KEY` | Tiempo real | Los cambios de otros dispositivos se ven al recargar o reconectar |
| `GOOGLE_CLIENT_ID` | Login con Google (credencial OAuth "Aplicación web", orígenes autorizados `http://localhost:5173` y la URL de producción) | No aparece el botón de Google |
| `AUTH_DEV_LOGIN=1` | Entrar solo con un email, para desarrollo. Nunca se activa en Vercel | — |

Las migraciones son idempotentes y se aplican al arrancar el servidor local (`npm run db:init` las corre por separado).

## Tests

```bash
npm test
```

- `server/*.test.ts`: API completa contra una base libSQL temporal (sesiones, permisos, listas, calendarios, grupos, invitaciones, compartir, y migrar sobre bases con esquemas anteriores). Google se simula.
- `src/**/*.test.ts`: lógica del cliente (orden de listas, calendario y la cola offline con IndexedDB simulada).

## Producción (Vercel)

El frontend se publica como estático y la API (`api/index.ts` → `server/app.ts`) como función serverless; ver [vercel.json](vercel.json). Cada push a `master` publica. El build (`vercel-build`) aplica las migraciones antes de compilar.

Variables en Vercel: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ABLY_API_KEY`, `GOOGLE_CLIENT_ID`.

Para correrla como servidor Node tradicional:

```bash
npm run build
npm start
```

## Estructura

```
server/
  app.ts              Express: middlewares y montaje de rutas
  routes/             auth, me, lists, families, calendar, invitations, realtime
  db/                 acceso a datos por dominio + migrations.ts
  auth/               verificación de Google y permisos (listAccess)
  http/               sesión, validaciones y middlewares
src/
  App.tsx             rutas y proveedores
  auth/  data/        sesión, datos del usuario, conexión y cola offline
  shell/              cabecera, menú y navegación
  lists/ family/ invitations/ calendar/ components/
```

## Instalación móvil

- Android: "Instalar Casa" dentro de la aplicación o "Agregar a pantalla principal" en Chrome.
- iPhone/iPad: abre la aplicación en Safari, pulsa Compartir y elige "Agregar a pantalla de inicio".
