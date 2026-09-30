# Casa

PWA para organizar el hogar. Incluye listas de compras, tareas y un calendario compartido sincronizados en tiempo real entre los integrantes de una familia.

## Desarrollo

```bash
npm install
npm run dev
```

La web queda en `http://localhost:5173` y el servidor en `http://localhost:3001`.

Para correr los tests:

```bash
npm test
```

Para probar desde un teléfono en la misma red, abre `http://IP-DE-TU-PC:5173`. Vite acepta conexiones de red y redirige la API al servidor local.

En desarrollo se usa una base libSQL local en `data/home-plan.db`. Si existe el antiguo `data/db.json`, sus datos se importan automáticamente.

Para conectarse a Turso:

```bash
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

El tiempo real usa [Ably](https://ably.com). Sin `ABLY_API_KEY` la app funciona igual, pero los cambios de otros dispositivos se ven al recargar o reconectar.

```bash
ABLY_API_KEY=...
```

## Producción (Vercel)

La app se despliega en Vercel: el frontend se sirve como estático y la API (`api/index.ts` → `server/app.ts`) como función serverless. Configuración en `vercel.json`.

Variables de entorno en Vercel: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ABLY_API_KEY`. El build ejecuta `npm run db:init` para aplicar las migraciones antes de compilar.

Para correrla como servidor Node tradicional:

```bash
npm run build
npm start
```

El servidor publica la aplicación completa en `http://localhost:3001`.

## Instalación móvil

- Android: usa “Instalar Casa” dentro de la aplicación o “Agregar a pantalla principal” en Chrome.
- iPhone/iPad: abre la aplicación en Safari, pulsa Compartir y elige “Agregar a pantalla de inicio”.

## Alcance actual

- Sin cuentas: el código familiar funciona como acceso compartido.
- Los datos se guardan en Turso/libSQL.
- La sincronización en tiempo real usa Ably (aviso de cambios + recarga desde la API).
- La aplicación es una PWA instalable.
- Compras, tareas y eventos del calendario pueden modificarse sin conexión; IndexedDB conserva una cola que se sincroniza automáticamente.
- La familia de prueba siempre está disponible con el código `CASA`.

Antes de guardar información sensible conviene agregar autenticación y permisos por familia.
