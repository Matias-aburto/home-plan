# Casa

PWA para organizar el hogar. Incluye listas de compras y tareas sincronizadas en tiempo real entre los integrantes de una familia.

## Desarrollo

```bash
npm install
npm run dev
```

La web queda en `http://localhost:5173` y el servidor en `http://localhost:3001`.

Para probar desde un teléfono en la misma red, abre `http://IP-DE-TU-PC:5173`. Vite acepta conexiones de red y redirige la API al servidor local.

En desarrollo se usa una base libSQL local en `data/home-plan.db`. Si existe el antiguo `data/db.json`, sus datos se importan automáticamente.

Para conectarse a Turso:

```bash
TURSO_DATABASE_URL=libsql://... 
TURSO_AUTH_TOKEN=...
```

## Producción

```bash
npm run build
npm start
```

El servidor publica la aplicación completa en `http://localhost:3001`.

## Alcance actual

- Sin cuentas: el código familiar funciona como acceso compartido.
- Los datos se guardan en Turso/libSQL.
- La sincronización usa WebSockets.
- La aplicación es una PWA instalable.
- Compras y tareas pueden modificarse sin conexión; IndexedDB conserva una cola que se sincroniza automáticamente.
- La familia de prueba siempre está disponible con el código `CASA`.

Antes de guardar información sensible conviene agregar autenticación y permisos por familia.
