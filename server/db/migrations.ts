import { mkdir } from "node:fs/promises";
import { databaseUrl, db, localDataDirectory } from "./client.js";

// Crea o actualiza el esquema. Es idempotente: se ejecuta en cada deploy y al iniciar el servidor local.
export async function migrate() {
  if (databaseUrl.startsWith("file:")) await mkdir(localDataDirectory, { recursive: true });
  await db.batch([
    "PRAGMA foreign_keys = ON",
    `CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS calendar_entries (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      recurrence TEXT NOT NULL DEFAULT 'none',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_sub TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      avatar_url TEXT,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      user_agent TEXT
    )`,
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    `CREATE TABLE IF NOT EXISTS family_members (
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (family_id, user_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members(user_id)",
    // Invitaciones a una familia o (Etapa 5) a una lista. Del enlace solo se guarda el hash del token.
    `CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('family', 'list')),
      family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
      list_id TEXT,
      invited_email TEXT NOT NULL,
      offered_role TEXT NOT NULL,
      invited_by TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      responded_at TEXT,
      responded_by TEXT REFERENCES users(id),
      CHECK ((kind = 'family' AND family_id IS NOT NULL AND list_id IS NULL)
        OR (kind = 'list' AND list_id IS NOT NULL AND family_id IS NULL))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(invited_email, status)",
    "CREATE INDEX IF NOT EXISTS idx_invitations_family ON invitations(family_id, status)",
    // Listas nuevas: el dueño es un usuario (personal) o una familia (compartida), nunca ambos.
    `CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('shopping', 'tasks', 'checklist')),
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      CHECK ((owner_user_id IS NULL) <> (family_id IS NULL))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_lists_owner ON lists(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_lists_family ON lists(family_id)",
    // Ubicaciones con el mismo dueño que las listas; se comparten entre sus listas.
    `CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK ((owner_user_id IS NULL) <> (family_id IS NULL))
    )`,
    `CREATE TABLE IF NOT EXISTS list_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      location_id TEXT REFERENCES places(id) ON DELETE SET NULL,
      assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      archived_at TEXT
    )`,
    "CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id, completed, archived_at)",
    // Personas con quienes se compartió una lista puntual, fuera de su dueño o familia.
    `CREATE TABLE IF NOT EXISTS list_members (
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL CHECK (permission IN ('editor', 'viewer')),
      added_by TEXT NOT NULL REFERENCES users(id),
      added_at TEXT NOT NULL,
      PRIMARY KEY (list_id, user_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_list_members_user ON list_members(user_id)",
    // Preferencias de cada usuario sobre cada lista: orden en su menú y orden de los ítems.
    `CREATE TABLE IF NOT EXISTS user_list_prefs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      sort TEXT NOT NULL DEFAULT 'custom' CHECK (sort IN ('custom', 'alpha')),
      PRIMARY KEY (user_id, list_id)
    )`,
    // Productos usados antes, por dueño: "user:<id>" o "family:<id>".
    `CREATE TABLE IF NOT EXISTS learned_names (
      scope TEXT NOT NULL,
      name_key TEXT NOT NULL,
      name TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL,
      PRIMARY KEY (scope, name_key)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_calendar_family_date ON calendar_entries(family_id, event_date)",
    // Calendarios: como las listas, su dueño es una persona o un grupo. Reemplazan a calendar_entries.
    `CREATE TABLE IF NOT EXISTS calendars (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      CHECK ((owner_user_id IS NULL) <> (family_id IS NULL))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_calendars_owner ON calendars(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_calendars_family ON calendars(family_id)",
    // Un calendario por espacio.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_calendars_owner ON calendars(owner_user_id) WHERE owner_user_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_calendars_family ON calendars(family_id) WHERE family_id IS NOT NULL",
    `CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      recurrence TEXT NOT NULL DEFAULT 'none',
      notes TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(calendar_id, event_date)",
    // Color con que cada persona ve cada espacio ("personal" o id del grupo) en el calendario.
    `CREATE TABLE IF NOT EXISTS user_space_colors (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      space TEXT NOT NULL,
      color TEXT NOT NULL,
      PRIMARY KEY (user_id, space)
    )`,
    // Cambios de datos que se aplican una sola vez.
    `CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  ], "write");

  // Las bases creadas antes de las cuentas tienen `families` sin esta columna.
  await ensureColumn("families", "created_by", "TEXT REFERENCES users(id)");

  await runOnce("single-list-kind", [
    // Un solo tipo de lista: sin compras/tareas, ubicaciones ni responsables.
    { sql: "UPDATE lists SET kind = 'checklist' WHERE kind <> 'checklist'", args: [] },
    {
      sql: "UPDATE list_items SET location_id = NULL, assignee_user_id = NULL WHERE location_id IS NOT NULL OR assignee_user_id IS NOT NULL",
      args: []
    }
  ]);
  await runOnce("group-calendars", await groupCalendarStatements());
  // Evento y recordatorio se unifican: sin notificaciones, eran lo mismo.
  await runOnce("single-event-kind", [{ sql: "UPDATE calendar_events SET kind = 'event' WHERE kind <> 'event'", args: [] }]);
}

// Aplica los cambios en una transacción y los registra, para que no se repitan en cada deploy.
async function runOnce(name: string, statements: { sql: string; args: (string | null)[] }[]) {
  const done = await db.execute({ sql: "SELECT 1 FROM app_migrations WHERE name = ?", args: [name] });
  if (done.rows.length) return;
  await db.batch([
    ...statements,
    { sql: "INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)", args: [name, new Date().toISOString()] }
  ], "write");
}

// Cada grupo que ya tenía eventos en su calendario único pasa a tener un calendario "Calendario" con ellos.
async function groupCalendarStatements() {
  const groups = await db.execute(`
    SELECT f.id AS family_id,
      (SELECT m.user_id FROM family_members m WHERE m.family_id = f.id ORDER BY m.role = 'owner' DESC, m.joined_at LIMIT 1) AS owner_id
    FROM families f
    WHERE EXISTS (SELECT 1 FROM calendar_entries e WHERE e.family_id = f.id)
      AND EXISTS (SELECT 1 FROM family_members m WHERE m.family_id = f.id)`);
  const now = new Date().toISOString();
  return groups.rows.flatMap((row) => {
    const calendarId = `cal-${String(row.family_id)}`;
    return [
      {
        sql: `INSERT OR IGNORE INTO calendars (id, owner_user_id, family_id, name, icon, color, created_by, created_at, updated_at)
          VALUES (?, NULL, ?, 'Calendario', 'calendar', 'blue', ?, ?, ?)`,
        args: [calendarId, String(row.family_id), String(row.owner_id), now, now]
      },
      {
        sql: `INSERT OR IGNORE INTO calendar_events
          (id, calendar_id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at)
          SELECT id, ?, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at
          FROM calendar_entries WHERE family_id = ?`,
        args: [calendarId, String(row.family_id)]
      }
    ];
  });
}

async function ensureColumn(table: string, column: string, definition: string) {
  const columns = await db.execute(`PRAGMA table_info(${table})`);
  if (columns.rows.some((row) => String(row.name) === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
