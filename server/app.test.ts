import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type FamilyResponse = {
  id: string;
  name: string;
  locations: { id: string; name: string }[];
  items: { id: string; name: string; completed: boolean; position: number; locationId: string | null }[];
  tasks: { id: string; title: string; completed: boolean; assignee: string | null; locationId: string | null }[];
  calendarEntries: { id: string; title: string; date: string; time: string | null }[];
};

let api: Agent;

beforeAll(async () => {
  await migrate();
  api = (await loginAgent()).agent;
});

async function createFamily(name = "Familia test") {
  const response = await api.post("/api/families").send({ name }).expect(201);
  return response.body as FamilyResponse;
}

async function getFamily(id: string) {
  return (await api.get(`/api/families/${id}`).expect(200)).body as FamilyResponse;
}

describe("salud y tiempo real", () => {
  it("responde health sin tiempo real configurado", async () => {
    const response = await api.get("/api/health").expect(200);
    expect(response.body).toEqual({ ok: true, realtime: false });
  });

  it("no entrega token de tiempo real sin clave de Ably", async () => {
    const family = await createFamily();
    await api.get(`/api/families/${family.id}/realtime-token`).expect(503);
    await api.get("/api/families/NOEXISTE/realtime-token").expect(404);
  });
});

describe("familias", () => {
  it("crea una familia con ubicaciones por defecto", async () => {
    const family = await createFamily("  Familia Pérez  ");
    expect(family.name).toBe("Familia Pérez");
    expect(family.id).toMatch(/^[A-Z0-9]{8}$/);
    expect(family.locations.map(({ name }) => name)).toEqual(["Ciudad", "Campo"]);
  });

  it("valida el nombre y responde 404 si no existe", async () => {
    await api.post("/api/families").send({ name: "   " }).expect(400);
    await api.get("/api/families/NOEXISTE").expect(404);
  });

  it("encuentra la familia sin importar mayúsculas", async () => {
    const family = await createFamily();
    const found = await getFamily(family.id.toLowerCase());
    expect(found.id).toBe(family.id);
  });

  it("existe la familia de prueba CASA", async () => {
    await api.get("/api/families/CASA").expect(200);
  });
});

describe("lista de compras", () => {
  it("agrega, capitaliza e ignora ubicaciones ajenas", async () => {
    const family = await createFamily();
    const item = (await api.post(`/api/families/${family.id}/items`)
      .send({ name: "leche", locationId: "no-existe" }).expect(201)).body;
    expect(item.name).toBe("Leche");
    expect(item.locationId).toBeNull();
    await api.post(`/api/families/${family.id}/items`).send({ name: "  " }).expect(400);
    await api.post("/api/families/NOEXISTE/items").send({ name: "Pan" }).expect(404);
  });

  it("es idempotente con el id del cliente", async () => {
    const family = await createFamily();
    const body = { id: "cliente-1", name: "Pan" };
    await api.post(`/api/families/${family.id}/items`).send(body).expect(201);
    await api.post(`/api/families/${family.id}/items`).send(body).expect(201);
    expect((await getFamily(family.id)).items).toHaveLength(1);
  });

  it("pone los nuevos ítems arriba de la lista", async () => {
    const family = await createFamily();
    for (const name of ["Uno", "Dos", "Tres"]) {
      await api.post(`/api/families/${family.id}/items`).send({ name }).expect(201);
    }
    expect((await getFamily(family.id)).items.map(({ name }) => name)).toEqual(["Tres", "Dos", "Uno"]);
  });

  it("completa, edita y elimina", async () => {
    const family = await createFamily();
    const location = family.locations[0];
    const item = (await api.post(`/api/families/${family.id}/items`).send({ name: "Arroz" })).body;

    const completed = await api.patch(`/api/families/${family.id}/items/${item.id}`)
      .send({ completed: true }).expect(200);
    expect(completed.body.completed).toBe(true);

    const edited = await api.patch(`/api/families/${family.id}/items/${item.id}`)
      .send({ name: "arroz integral", locationId: location.id }).expect(200);
    expect(edited.body).toMatchObject({ name: "Arroz integral", locationId: location.id });

    await api.patch(`/api/families/${family.id}/items/${item.id}`).send({}).expect(400);
    await api.patch(`/api/families/${family.id}/items/no-existe`).send({ completed: true }).expect(404);

    await api.delete(`/api/families/${family.id}/items/${item.id}`).expect(204);
    expect((await getFamily(family.id)).items).toHaveLength(0);
  });

  it("reordena solo los pendientes", async () => {
    const family = await createFamily();
    const ids: string[] = [];
    for (const name of ["A", "B", "C"]) {
      ids.push((await api.post(`/api/families/${family.id}/items`).send({ name })).body.id);
    }
    await api.patch(`/api/families/${family.id}/items/${ids[1]}`).send({ completed: true });
    await api.post(`/api/families/${family.id}/items/reorder`).send({ ids: [ids[0], ids[1], ids[2]] }).expect(200);

    const pending = (await getFamily(family.id)).items.filter(({ completed }) => !completed);
    expect(pending.map(({ name }) => name)).toEqual(["A", "C"]);
    await api.post(`/api/families/${family.id}/items/reorder`).send({ ids: [] }).expect(400);
  });

  it("sugiere productos del catálogo y los aprendidos", async () => {
    const family = await createFamily();
    await api.post(`/api/families/${family.id}/items`).send({ name: "Lechuga hidropónica" });
    const response = await api.get(`/api/families/${family.id}/suggestions`).query({ q: "lech" }).expect(200);
    const names = response.body.map(({ name }: { name: string }) => name);
    expect(names[0]).toBe("Lechuga hidropónica");
    expect(names).toContain("Leche");
    expect((await api.get(`/api/families/${family.id}/suggestions`).query({ q: "l" })).body).toEqual([]);
  });
});

describe("tareas", () => {
  it("crea con responsable válido y descarta los desconocidos", async () => {
    const family = await createFamily();
    const task = (await api.post(`/api/families/${family.id}/tasks`)
      .send({ title: "regar", assignee: "Francisca" }).expect(201)).body;
    expect(task).toMatchObject({ title: "Regar", assignee: "Francisca" });

    const other = (await api.post(`/api/families/${family.id}/tasks`)
      .send({ title: "Barrer", assignee: "Alguien" }).expect(201)).body;
    expect(other.assignee).toBeNull();
    await api.post(`/api/families/${family.id}/tasks`).send({ title: "" }).expect(400);
  });

  it("actualiza parcialmente, reordena y elimina", async () => {
    const family = await createFamily();
    const location = family.locations[1];
    const first = (await api.post(`/api/families/${family.id}/tasks`).send({ title: "Uno" })).body;
    const second = (await api.post(`/api/families/${family.id}/tasks`).send({ title: "Dos" })).body;

    const updated = await api.patch(`/api/families/${family.id}/tasks/${first.id}`)
      .send({ assignee: "Matías", locationId: location.id }).expect(200);
    expect(updated.body).toMatchObject({ title: "Uno", assignee: "Matías", locationId: location.id, completed: false });

    const completed = await api.patch(`/api/families/${family.id}/tasks/${first.id}`)
      .send({ completed: true }).expect(200);
    expect(completed.body).toMatchObject({ completed: true, assignee: "Matías" });

    await api.patch(`/api/families/${family.id}/tasks/${first.id}`).send({ title: " " }).expect(400);
    await api.patch(`/api/families/${family.id}/tasks/no-existe`).send({ completed: true }).expect(404);

    await api.post(`/api/families/${family.id}/tasks/reorder`).send({ ids: [second.id] }).expect(200);
    await api.delete(`/api/families/${family.id}/tasks/${second.id}`).expect(204);
    expect((await getFamily(family.id)).tasks.map(({ title }) => title)).toEqual(["Uno"]);
  });
});

describe("calendario", () => {
  it("crea, edita, valida y elimina entradas", async () => {
    const family = await createFamily();
    const entry = (await api.post(`/api/families/${family.id}/calendar`).send({
      title: "Cumpleaños",
      kind: "event",
      date: "2026-10-12",
      time: "18:30",
      recurrence: "yearly"
    }).expect(201)).body;
    expect(entry).toMatchObject({ title: "Cumpleaños", time: "18:30", recurrence: "yearly", notes: null });

    await api.post(`/api/families/${family.id}/calendar`)
      .send({ title: "Mal", kind: "event", date: "2026-02-30" }).expect(400);
    await api.post(`/api/families/${family.id}/calendar`)
      .send({ title: "Mal", kind: "event", date: "2026-02-10", time: "25:00" }).expect(400);
    await api.post(`/api/families/${family.id}/calendar`)
      .send({ title: "Mal", kind: "otro", date: "2026-02-10" }).expect(400);

    const edited = await api.patch(`/api/families/${family.id}/calendar/${entry.id}`)
      .send({ title: "Cumpleaños mamá", kind: "reminder", date: "2026-10-13" }).expect(200);
    expect(edited.body).toMatchObject({ title: "Cumpleaños mamá", kind: "reminder", time: null, recurrence: "none" });

    await api.delete(`/api/families/${family.id}/calendar/${entry.id}`).expect(204);
    await api.delete(`/api/families/${family.id}/calendar/${entry.id}`).expect(404);
  });
});

describe("ubicaciones", () => {
  it("agrega, evita duplicados, renombra y elimina", async () => {
    const family = await createFamily();
    const location = (await api.post(`/api/families/${family.id}/locations`).send({ name: "Playa" }).expect(201)).body;
    await api.post(`/api/families/${family.id}/locations`).send({ name: "playa" }).expect(409);
    await api.post(`/api/families/${family.id}/locations`).send({ name: "" }).expect(400);

    await api.patch(`/api/families/${family.id}/locations/${location.id}`).send({ name: "Ciudad" }).expect(409);
    await api.patch(`/api/families/${family.id}/locations/${location.id}`).send({ name: "Costa" }).expect(200);

    const item = (await api.post(`/api/families/${family.id}/items`).send({ name: "Bloqueador", locationId: location.id })).body;
    expect(item.locationId).toBe(location.id);

    await api.delete(`/api/families/${family.id}/locations/${location.id}`).expect(204);
    const updated = await getFamily(family.id);
    expect(updated.locations.map(({ name }) => name)).toEqual(["Ciudad", "Campo"]);
    expect(updated.items[0].locationId).toBeNull();
  });
});
