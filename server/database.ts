import { createClient, type Client, type InValue } from "@libsql/client";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

export type ShoppingItem = {
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

export type Location = { id: string; name: string };
export type Assignee = "Matías" | "Francisca";

export type HouseholdTask = {
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

export type CalendarEntry = {
  id: string;
  title: string;
  kind: "event" | "reminder";
  date: string;
  time: string | null;
  recurrence: "none" | "yearly";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LearnedProduct = {
  name: string;
  uses: number;
  lastUsedAt: string;
};

export type Family = {
  id: string;
  name: string;
  createdAt: string;
  locations: Location[];
  learnedProducts: LearnedProduct[];
  items: ShoppingItem[];
  tasks: HouseholdTask[];
  calendarEntries: CalendarEntry[];
};

type LegacyDatabase = { families?: Record<string, Partial<Family>> };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localDataDirectory = path.join(__dirname, "../data");
const databaseUrl = process.env.TURSO_DATABASE_URL || `file:${path.join(localDataDirectory, "home-plan.db")}`;
const client = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function value(value: unknown): InValue {
  return value === undefined ? null : value as InValue;
}

function text(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

export function normalizeText(input: string) {
  return input.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

export class HomeRepository {
  constructor(private readonly db: Client = client) {}

  async initialize() {
    if (databaseUrl.startsWith("file:")) await mkdir(localDataDirectory, { recursive: true });
    await this.db.batch([
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
      "CREATE INDEX IF NOT EXISTS idx_items_family ON shopping_items(family_id, completed, archived_at)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_family ON household_tasks(family_id, completed, archived_at)",
      "CREATE INDEX IF NOT EXISTS idx_calendar_family_date ON calendar_entries(family_id, event_date)"
    ], "write");

    const taskColumns = await this.db.execute("PRAGMA table_info(household_tasks)");
    if (!taskColumns.rows.some((column) => String(column.name) === "location_id")) {
      await this.db.execute(
        "ALTER TABLE household_tasks ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL"
      );
    }
    await this.ensurePositionColumn("shopping_items");
    await this.ensurePositionColumn("household_tasks");

    await this.importLegacyData();
    await this.backfillPositions("shopping_items");
    await this.backfillPositions("household_tasks");
    if (!(await this.getFamily("CASA"))) await this.createFamily("Familia de prueba", "CASA");
  }

  private async ensurePositionColumn(table: "shopping_items" | "household_tasks") {
    const columns = await this.db.execute(`PRAGMA table_info(${table})`);
    if (columns.rows.some((column) => String(column.name) === "position")) return;
    await this.db.execute(`ALTER TABLE ${table} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
  }

  private async backfillPositions(table: "shopping_items" | "household_tasks") {
    const families = await this.db.execute("SELECT id FROM families");
    for (const family of families.rows) {
      const pending = await this.db.execute({
        sql: `SELECT id, position FROM ${table} WHERE family_id = ? AND completed = 0 ORDER BY created_at DESC`,
        args: [String(family.id)]
      });
      if (pending.rows.length < 2) continue;
      const positions = new Set(pending.rows.map((row) => Number(row.position)));
      if (positions.size > 1) continue;
      for (const [index, row] of pending.rows.entries()) {
        await this.db.execute({
          sql: `UPDATE ${table} SET position = ? WHERE id = ?`,
          args: [index, String(row.id)]
        });
      }
    }
  }

  private async nextPosition(table: "shopping_items" | "household_tasks", familyId: string) {
    const result = await this.db.execute({
      sql: `SELECT MIN(position) AS top FROM ${table} WHERE family_id = ? AND completed = 0`,
      args: [familyId.toUpperCase()]
    });
    const top = result.rows[0]?.top;
    return top === null || top === undefined ? 0 : Number(top) - 1;
  }

  private async importLegacyData() {
    const count = await this.db.execute("SELECT COUNT(*) AS total FROM families");
    if (Number(count.rows[0]?.total || 0) > 0) return;

    try {
      const legacy = JSON.parse(await readFile(path.join(localDataDirectory, "db.json"), "utf8")) as LegacyDatabase;
      for (const [id, rawFamily] of Object.entries(legacy.families || {})) {
        const createdAt = rawFamily.createdAt || new Date().toISOString();
        await this.db.execute({
          sql: "INSERT OR IGNORE INTO families (id, name, created_at) VALUES (?, ?, ?)",
          args: [id, rawFamily.name || "Mi familia", createdAt]
        });
        for (const location of rawFamily.locations || []) {
          await this.db.execute({
            sql: "INSERT OR IGNORE INTO locations (id, family_id, name) VALUES (?, ?, ?)",
            args: [location.id, id, location.name]
          });
        }
        for (const item of rawFamily.items || []) await this.insertLegacyItem(id, item);
        for (const task of rawFamily.tasks || []) await this.insertLegacyTask(id, task);
        for (const product of rawFamily.learnedProducts || []) {
          await this.db.execute({
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

  private async insertLegacyItem(familyId: string, item: ShoppingItem) {
    const updatedAt = item.updatedAt || item.createdAt;
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO shopping_items
        (id, family_id, name, location_id, completed, position, created_at, updated_at, completed_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        item.id, familyId, item.name, value(item.locationId), item.completed ? 1 : 0, item.position || 0,
        item.createdAt, updatedAt, value(item.completedAt || (item.completed ? updatedAt : null)), value(item.archivedAt)
      ]
    });
  }

  private async insertLegacyTask(familyId: string, task: HouseholdTask) {
    const updatedAt = task.updatedAt || task.createdAt;
    await this.db.execute({
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

  async createFamily(name: string, requestedId?: string) {
    const id = requestedId || nanoid(8).replace(/[-_]/g, "A").toUpperCase();
    const now = new Date().toISOString();
    await this.db.batch([
      { sql: "INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)", args: [id, name, now] },
      { sql: "INSERT INTO locations (id, family_id, name) VALUES (?, ?, ?)", args: [nanoid(8), id, "Ciudad"] },
      { sql: "INSERT INTO locations (id, family_id, name) VALUES (?, ?, ?)", args: [nanoid(8), id, "Campo"] }
    ], "write");
    return (await this.getFamily(id))!;
  }

  async getFamily(id: string): Promise<Family | null> {
    const familyResult = await this.db.execute({
      sql: "SELECT id, name, created_at FROM families WHERE id = ?",
      args: [id.toUpperCase()]
    });
    const familyRow = familyResult.rows[0];
    if (!familyRow) return null;

    const now = new Date().toISOString();
    await Promise.all([
      this.archiveOlder("shopping_items", id, now),
      this.archiveOlder("household_tasks", id, now)
    ]);

    const [locationsResult, itemsResult, tasksResult, calendarResult] = await Promise.all([
      this.db.execute({ sql: "SELECT id, name FROM locations WHERE family_id = ? ORDER BY rowid", args: [id.toUpperCase()] }),
      this.db.execute({
        sql: `SELECT id, name, location_id, completed, position, created_at, updated_at, completed_at, archived_at
          FROM shopping_items WHERE family_id = ? ORDER BY position ASC, created_at DESC`,
        args: [id.toUpperCase()]
      }),
      this.db.execute({
        sql: `SELECT id, title, assignee, location_id, completed, position, created_at, updated_at, completed_at, archived_at
          FROM household_tasks WHERE family_id = ? ORDER BY position ASC, created_at DESC`,
        args: [id.toUpperCase()]
      }),
      this.db.execute({
        sql: `SELECT id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at
          FROM calendar_entries WHERE family_id = ? ORDER BY event_date, event_time, created_at`,
        args: [id.toUpperCase()]
      })
    ]);

    return {
      id: String(familyRow.id),
      name: String(familyRow.name),
      createdAt: String(familyRow.created_at),
      locations: locationsResult.rows.map((row) => ({ id: String(row.id), name: String(row.name) })),
      learnedProducts: [],
      items: itemsResult.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        locationId: text(row.location_id),
        completed: Boolean(row.completed),
        position: Number(row.position || 0),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        completedAt: text(row.completed_at),
        archivedAt: text(row.archived_at)
      })),
      tasks: tasksResult.rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        assignee: text(row.assignee) as Assignee | null,
        locationId: text(row.location_id),
        completed: Boolean(row.completed),
        position: Number(row.position || 0),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        completedAt: text(row.completed_at),
        archivedAt: text(row.archived_at)
      })),
      calendarEntries: calendarResult.rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        kind: String(row.kind) as CalendarEntry["kind"],
        date: String(row.event_date),
        time: text(row.event_time),
        recurrence: String(row.recurrence) as CalendarEntry["recurrence"],
        notes: text(row.notes),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      }))
    };
  }

  async getLearnedProducts(familyId: string, query: string) {
    const result = await this.db.execute({
      sql: `SELECT name, uses, last_used_at FROM learned_products
        WHERE family_id = ? AND name_key LIKE ? ORDER BY uses DESC, last_used_at DESC LIMIT 20`,
      args: [familyId.toUpperCase(), `%${normalizeText(query)}%`]
    });
    return result.rows.map((row) => ({
      name: String(row.name),
      uses: Number(row.uses),
      lastUsedAt: String(row.last_used_at)
    }));
  }

  async addItem(familyId: string, name: string, locationId: string | null, requestedId?: string) {
    const family = await this.getFamily(familyId);
    if (!family) return null;
    const existing = requestedId ? family.items.find(({ id }) => id === requestedId) : undefined;
    if (existing) return existing;
    const validLocation = family.locations.some(({ id }) => id === locationId) ? locationId : null;
    const now = new Date().toISOString();
    const position = await this.nextPosition("shopping_items", familyId);
    const item: ShoppingItem = {
      id: requestedId || nanoid(), name, locationId: validLocation, completed: false, position,
      createdAt: now, updatedAt: now, completedAt: null, archivedAt: null
    };
    await this.db.batch([
      {
        sql: `INSERT OR IGNORE INTO shopping_items
          (id, family_id, name, location_id, completed, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        args: [item.id, familyId.toUpperCase(), name, value(validLocation), position, now, now]
      },
      {
        sql: `INSERT INTO learned_products (family_id, name_key, name, uses, last_used_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(family_id, name_key) DO UPDATE SET
          name = excluded.name, uses = uses + 1, last_used_at = excluded.last_used_at`,
        args: [familyId.toUpperCase(), normalizeText(name), name, now]
      }
    ], "write");
    return item;
  }

  async setItemCompleted(familyId: string, itemId: string, completed: boolean) {
    const now = new Date().toISOString();
    const result = await this.db.execute({
      sql: `UPDATE shopping_items SET completed = ?, updated_at = ?, completed_at = ?, archived_at = NULL
        WHERE id = ? AND family_id = ?`,
      args: [completed ? 1 : 0, now, value(completed ? now : null), itemId, familyId.toUpperCase()]
    });
    if (result.rowsAffected === 0) return false;
    await this.archiveOlder("shopping_items", familyId, now);
    return true;
  }

  async updateItemDetails(familyId: string, itemId: string, name: string, locationId: string | null) {
    const family = await this.getFamily(familyId);
    if (!family) return false;
    const validLocation = family.locations.some(({ id }) => id === locationId) ? locationId : null;
    const result = await this.db.execute({
      sql: `UPDATE shopping_items SET name = ?, location_id = ?, updated_at = ?
        WHERE id = ? AND family_id = ?`,
      args: [name, value(validLocation), new Date().toISOString(), itemId, familyId.toUpperCase()]
    });
    return result.rowsAffected > 0;
  }

  async reorderItems(familyId: string, ids: string[]) {
    return this.reorderEntries("shopping_items", familyId, ids);
  }

  async reorderTasks(familyId: string, ids: string[]) {
    return this.reorderEntries("household_tasks", familyId, ids);
  }

  private async reorderEntries(
    table: "shopping_items" | "household_tasks",
    familyId: string,
    ids: string[]
  ) {
    if (!(await this.getFamily(familyId))) return false;
    const pending = await this.db.execute({
      sql: `SELECT id FROM ${table} WHERE family_id = ? AND completed = 0`,
      args: [familyId.toUpperCase()]
    });
    const pendingIds = new Set(pending.rows.map((row) => String(row.id)));
    const ordered = [...new Set(ids)].filter((id) => pendingIds.has(id));
    if (ordered.length === 0) return true;
    await this.db.batch(ordered.map((id, index) => ({
      sql: `UPDATE ${table} SET position = ? WHERE id = ? AND family_id = ?`,
      args: [index, id, familyId.toUpperCase()]
    })), "write");
    return true;
  }

  async deleteItem(familyId: string, itemId: string) {
    const result = await this.db.execute({
      sql: "DELETE FROM shopping_items WHERE id = ? AND family_id = ?",
      args: [itemId, familyId.toUpperCase()]
    });
    return result.rowsAffected > 0;
  }

  async addTask(
    familyId: string,
    title: string,
    assignee: Assignee | null,
    locationId: string | null,
    requestedId?: string
  ) {
    const family = await this.getFamily(familyId);
    if (!family) return null;
    const existing = requestedId ? family.tasks.find(({ id }) => id === requestedId) : undefined;
    if (existing) return existing;
    const validLocation = family.locations.some(({ id }) => id === locationId) ? locationId : null;
    const now = new Date().toISOString();
    const position = await this.nextPosition("household_tasks", familyId);
    const task: HouseholdTask = {
      id: requestedId || nanoid(), title, assignee, locationId: validLocation, completed: false, position,
      createdAt: now, updatedAt: now, completedAt: null, archivedAt: null
    };
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO household_tasks
        (id, family_id, title, assignee, location_id, completed, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      args: [task.id, familyId.toUpperCase(), title, value(assignee), value(validLocation), position, now, now]
    });
    return task;
  }

  async updateTask(
    familyId: string,
    taskId: string,
    completed?: boolean,
    assignee?: Assignee | null,
    locationId?: string | null,
    title?: string
  ) {
    const current = await this.db.execute({
      sql: "SELECT title, completed, assignee, location_id FROM household_tasks WHERE id = ? AND family_id = ?",
      args: [taskId, familyId.toUpperCase()]
    });
    if (!current.rows[0]) return false;
    const nextCompleted = completed ?? Boolean(current.rows[0].completed);
    const nextTitle = title === undefined ? String(current.rows[0].title) : title;
    const nextAssignee = assignee === undefined ? text(current.rows[0].assignee) : assignee;
    const family = locationId === undefined ? null : await this.getFamily(familyId);
    const nextLocation = locationId === undefined
      ? text(current.rows[0].location_id)
      : family?.locations.some(({ id }) => id === locationId) ? locationId : null;
    const now = new Date().toISOString();
    await this.db.execute({
      sql: `UPDATE household_tasks SET title = ?, completed = ?, assignee = ?, location_id = ?, updated_at = ?,
        completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE NULL END,
        archived_at = NULL WHERE id = ? AND family_id = ?`,
      args: [
        nextTitle, nextCompleted ? 1 : 0, value(nextAssignee), value(nextLocation), now,
        nextCompleted ? 1 : 0, now,
        taskId, familyId.toUpperCase()
      ]
    });
    await this.archiveOlder("household_tasks", familyId, now);
    return true;
  }

  async deleteTask(familyId: string, taskId: string) {
    const result = await this.db.execute({
      sql: "DELETE FROM household_tasks WHERE id = ? AND family_id = ?",
      args: [taskId, familyId.toUpperCase()]
    });
    return result.rowsAffected > 0;
  }

  async addCalendarEntry(
    familyId: string,
    entry: Pick<CalendarEntry, "title" | "kind" | "date" | "time" | "recurrence" | "notes">,
    requestedId?: string
  ) {
    const family = await this.getFamily(familyId);
    if (!family) return null;
    const existing = requestedId
      ? family.calendarEntries.find(({ id }) => id === requestedId)
      : undefined;
    if (existing) return existing;
    const now = new Date().toISOString();
    const calendarEntry: CalendarEntry = {
      id: requestedId || nanoid(),
      ...entry,
      createdAt: now,
      updatedAt: now
    };
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO calendar_entries
        (id, family_id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        calendarEntry.id, familyId.toUpperCase(), entry.title, entry.kind, entry.date,
        value(entry.time), entry.recurrence, value(entry.notes), now, now
      ]
    });
    return calendarEntry;
  }

  async updateCalendarEntry(
    familyId: string,
    entryId: string,
    entry: Pick<CalendarEntry, "title" | "kind" | "date" | "time" | "recurrence" | "notes">
  ) {
    const now = new Date().toISOString();
    const result = await this.db.execute({
      sql: `UPDATE calendar_entries SET title = ?, kind = ?, event_date = ?, event_time = ?,
        recurrence = ?, notes = ?, updated_at = ? WHERE id = ? AND family_id = ?`,
      args: [
        entry.title, entry.kind, entry.date, value(entry.time), entry.recurrence,
        value(entry.notes), now, entryId, familyId.toUpperCase()
      ]
    });
    return result.rowsAffected > 0;
  }

  async deleteCalendarEntry(familyId: string, entryId: string) {
    const result = await this.db.execute({
      sql: "DELETE FROM calendar_entries WHERE id = ? AND family_id = ?",
      args: [entryId, familyId.toUpperCase()]
    });
    return result.rowsAffected > 0;
  }

  async addLocation(familyId: string, name: string) {
    if (!(await this.getFamily(familyId))) return null;
    const location: Location = { id: nanoid(8), name };
    await this.db.execute({
      sql: "INSERT INTO locations (id, family_id, name) VALUES (?, ?, ?)",
      args: [location.id, familyId.toUpperCase(), name]
    });
    return location;
  }

  async renameLocation(familyId: string, locationId: string, name: string) {
    const result = await this.db.execute({
      sql: "UPDATE locations SET name = ? WHERE id = ? AND family_id = ?",
      args: [name, locationId, familyId.toUpperCase()]
    });
    return result.rowsAffected > 0;
  }

  async deleteLocation(familyId: string, locationId: string) {
    const result = await this.db.execute({
      sql: "DELETE FROM locations WHERE id = ? AND family_id = ?",
      args: [locationId, familyId.toUpperCase()]
    });
    return result.rowsAffected > 0;
  }

  private async archiveOlder(table: "shopping_items" | "household_tasks", familyId: string, now: string) {
    const cutoff = new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
    await this.db.execute({
      sql: `UPDATE ${table}
        SET archived_at = CASE
          WHEN id IN (
            SELECT id FROM ${table}
            WHERE family_id = ? AND completed = 1
              AND COALESCE(completed_at, updated_at) >= ?
            ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 5
          ) THEN NULL
          ELSE COALESCE(archived_at, ?)
        END
        WHERE family_id = ? AND completed = 1`,
      args: [familyId.toUpperCase(), cutoff, now, familyId.toUpperCase()]
    });
  }
}
