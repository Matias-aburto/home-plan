import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { databaseUrl, db, localDataDirectory, normalizeText, value } from "./client.js";
import { migrateLegacyFamilies, systemUserId } from "./legacyMigration.js";
import type { Location } from "./types.js";

// Modelo anterior (familias por código): solo para importar el antiguo data/db.json.
type ShoppingItem = {
  id: string;
  name: string;
  locationId: string | null;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

type Assignee = "Matías" | "Francisca";

type HouseholdTask = {
  id: string;
  title: string;
  assignee: Assignee | null;
  locationId: string | null;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

type LearnedProduct = {
  name: string;
  uses: number;
  lastUsedAt: string;
};

type Family = {
  id: string;
  name: string;
  createdAt: string;
  locations: Location[];
  learnedProducts: LearnedProduct[];
  items: ShoppingItem[];
  tasks: HouseholdTask[];
  calendarEntries: unknown[];
};

type ListTable = "shopping_items" | "household_tasks";

type LegacyDatabase = { families?: Record<string, Partial<Family>> };

// Crea o actualiza el esquema. Es idempotente: se ejecuta en cada deploy y al iniciar el servidor local.
export async function migrate() {
  if (databaseUrl.startsWith("file:")) await mkdir(localDataDirectory, { recursive: true });
  await db.batch([
    "PRAGMA foreign_keys = ON",
    `CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      UNIQUE(family_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS shopping_items (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      archived_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS household_tasks (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      assignee TEXT,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      archived_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS learned_products (
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name_key TEXT NOT NULL,
      name TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL,
      PRIMARY KEY(family_id, name_key)
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
    // Ubicaciones con el mismo dueño que las listas (reemplazan a `locations` al migrar las familias).
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
      legacy_assignee TEXT,
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
    "CREATE INDEX IF NOT EXISTS idx_items_family ON shopping_items(family_id, completed, archived_at)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_family ON household_tasks(family_id, completed, archived_at)",
    "CREATE INDEX IF NOT EXISTS idx_calendar_family_date ON calendar_entries(family_id, event_date)"
  ], "write");

  const taskColumns = await db.execute("PRAGMA table_info(household_tasks)");
  if (!taskColumns.rows.some((column) => String(column.name) === "location_id")) {
    await db.execute(
      "ALTER TABLE household_tasks ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL"
    );
  }
  await ensurePositionColumn("shopping_items");
  await ensurePositionColumn("household_tasks");
  await ensureColumn("families", "created_by", "TEXT REFERENCES users(id)");
  await ensureColumn("families", "legacy_code_claimed_at", "TEXT");
  await ensureColumn("families", "lists_migrated_at", "TEXT");

  // Autor de las listas creadas por la migración, antes de que alguien reclame la familia.
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, google_sub, email, name, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [systemUserId, "system", "system@casa.local", "Casa", "green", new Date().toISOString()]
  });

  await importLegacyData();
  await backfillPositions("shopping_items");
  await backfillPositions("household_tasks");
  await migrateLegacyFamilies();
}

async function ensureColumn(table: string, column: string, definition: string) {
  const columns = await db.execute(`PRAGMA table_info(${table})`);
  if (columns.rows.some((row) => String(row.name) === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensurePositionColumn(table: ListTable) {
  const columns = await db.execute(`PRAGMA table_info(${table})`);
  if (columns.rows.some((column) => String(column.name) === "position")) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
}

async function backfillPositions(table: ListTable) {
  const families = await db.execute("SELECT id FROM families");
  for (const family of families.rows) {
    const pending = await db.execute({
      sql: `SELECT id, position FROM ${table} WHERE family_id = ? AND completed = 0 ORDER BY created_at DESC`,
      args: [String(family.id)]
    });
    if (pending.rows.length < 2) continue;
    const positions = new Set(pending.rows.map((row) => Number(row.position)));
    if (positions.size > 1) continue;
    for (const [index, row] of pending.rows.entries()) {
      await db.execute({
        sql: `UPDATE ${table} SET position = ? WHERE id = ?`,
        args: [index, String(row.id)]
      });
    }
  }
}

// Importa el antiguo data/db.json la primera vez que se usa la base.
async function importLegacyData() {
  const count = await db.execute("SELECT COUNT(*) AS total FROM families");
  if (Number(count.rows[0]?.total || 0) > 0) return;

  try {
    const legacy = JSON.parse(await readFile(path.join(localDataDirectory, "db.json"), "utf8")) as LegacyDatabase;
    for (const [id, rawFamily] of Object.entries(legacy.families || {})) {
      const createdAt = rawFamily.createdAt || new Date().toISOString();
      await db.execute({
        sql: "INSERT OR IGNORE INTO families (id, name, created_at) VALUES (?, ?, ?)",
        args: [id, rawFamily.name || "Mi familia", createdAt]
      });
      for (const location of rawFamily.locations || []) {
        await db.execute({
          sql: "INSERT OR IGNORE INTO locations (id, family_id, name) VALUES (?, ?, ?)",
          args: [location.id, id, location.name]
        });
      }
      for (const item of rawFamily.items || []) await insertLegacyItem(id, item);
      for (const task of rawFamily.tasks || []) await insertLegacyTask(id, task);
      for (const product of rawFamily.learnedProducts || []) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO learned_products
            (family_id, name_key, name, uses, last_used_at) VALUES (?, ?, ?, ?, ?)`,
          args: [id, normalizeText(product.name), product.name, product.uses, product.lastUsedAt]
        });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function insertLegacyItem(familyId: string, item: ShoppingItem) {
  const updatedAt = item.updatedAt || item.createdAt;
  await db.execute({
    sql: `INSERT OR IGNORE INTO shopping_items
      (id, family_id, name, location_id, completed, position, created_at, updated_at, completed_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      item.id, familyId, item.name, value(item.locationId), item.completed ? 1 : 0, item.position || 0,
      item.createdAt, updatedAt, value(item.completedAt || (item.completed ? updatedAt : null)), value(item.archivedAt)
    ]
  });
}

async function insertLegacyTask(familyId: string, task: HouseholdTask) {
  const updatedAt = task.updatedAt || task.createdAt;
  await db.execute({
    sql: `INSERT OR IGNORE INTO household_tasks
      (id, family_id, title, assignee, location_id, completed, position, created_at, updated_at, completed_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      task.id, familyId, task.title, value(task.assignee), value(task.locationId), task.completed ? 1 : 0,
      task.position || 0,
      task.createdAt, updatedAt, value(task.completedAt || (task.completed ? updatedAt : null)), value(task.archivedAt)
    ]
  });
}
