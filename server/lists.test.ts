import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type ListSummary = { id: string; name: string; kind: string; icon: string; color: string; access: string; pendingCount: number; sort: string; archivedAt: string | null };
type ListDetail = {
  list: ListSummary;
  items: { id: string; title: string; completed: boolean; locationId: string | null; archivedAt: string | null }[];
  locations: { id: string; name: string }[];
};

let ana: Agent;
let beto: Agent;

beforeAll(async () => {
  await migrate();
  ana = (await loginAgent()).agent;
  beto = (await loginAgent()).agent;
});

async function createList(agent: Agent, body: Record<string, unknown> = {}) {
  const response = await agent.post("/api/lists").send({ name: "Supermercado", kind: "shopping", ...body }).expect(201);
  return response.body as ListSummary;
}

async function detail(agent: Agent, listId: string) {
  return (await agent.get(`/api/lists/${listId}`).expect(200)).body as ListDetail;
}

describe("crear y gestionar listas", () => {
  it("crea con valores por defecto según el tipo", async () => {
    const list = await createList(ana, { name: "  compras del mes " });
    expect(list).toMatchObject({ name: "Compras del mes", kind: "shopping", icon: "shopping-basket", color: "green", access: "owner", pendingCount: 0, sort: "custom" });
    const checklist = await createList(ana, { name: "Maleta", kind: "checklist", icon: "plane", color: "blue" });
    expect(checklist).toMatchObject({ icon: "plane", color: "blue" });
  });

  it("valida nombre, tipo, ícono y color", async () => {
    await ana.post("/api/lists").send({ name: " ", kind: "shopping" }).expect(400);
    await ana.post("/api/lists").send({ name: "X", kind: "otro" }).expect(400);
    const list = await createList(ana, { icon: "no-existe", color: "fucsia" });
    expect(list).toMatchObject({ icon: "shopping-basket", color: "green" });
    await ana.patch(`/api/lists/${list.id}`).send({ icon: "no-existe" }).expect(400);
    await ana.patch(`/api/lists/${list.id}`).send({ name: "" }).expect(400);
  });

  it("es idempotente con el id del cliente y no deja reutilizar ids ajenos", async () => {
    const body = { id: "lista-cliente-1", name: "Offline", kind: "tasks" };
    await ana.post("/api/lists").send(body).expect(201);
    await ana.post("/api/lists").send(body).expect(201);
    await beto.post("/api/lists").send(body).expect(409);
    const me = (await ana.get("/api/me")).body;
    expect(me.lists.filter((list: ListSummary) => list.id === "lista-cliente-1")).toHaveLength(1);
  });

  it("aparece en /api/me en el orden elegido", async () => {
    const { agent } = await loginAgent();
    const first = await createList(agent, { name: "Uno" });
    const second = await createList(agent, { name: "Dos" });
    let me = (await agent.get("/api/me")).body;
    expect(me.lists.map((list: ListSummary) => list.name)).toEqual(["Uno", "Dos"]);
    await agent.put("/api/me/list-order").send({ ids: [second.id, first.id, "ajena"] }).expect(200);
    me = (await agent.get("/api/me")).body;
    expect(me.lists.map((list: ListSummary) => list.name)).toEqual(["Dos", "Uno"]);
  });

  it("renombra, archiva, restaura y elimina", async () => {
    const list = await createList(ana);
    const renamed = await ana.patch(`/api/lists/${list.id}`).send({ name: "feria", icon: "utensils", color: "amber" }).expect(200);
    expect(renamed.body).toMatchObject({ name: "Feria", icon: "utensils", color: "amber" });
    const archived = await ana.patch(`/api/lists/${list.id}`).send({ archived: true }).expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
    const restored = await ana.patch(`/api/lists/${list.id}`).send({ archived: false }).expect(200);
    expect(restored.body.archivedAt).toBeNull();

    await ana.post(`/api/lists/${list.id}/items`).send({ title: "Tomates" }).expect(201);
    await ana.delete(`/api/lists/${list.id}`).expect(204);
    await ana.get(`/api/lists/${list.id}`).expect(404);
  });

  it("guarda el orden de los ítems por usuario", async () => {
    const list = await createList(ana);
    await ana.put(`/api/lists/${list.id}/prefs`).send({ sort: "alpha" }).expect(200);
    await ana.put(`/api/lists/${list.id}/prefs`).send({ sort: "raro" }).expect(400);
    expect((await detail(ana, list.id)).list.sort).toBe("alpha");
  });
});

describe("permisos", () => {
  it("otro usuario no ve ni modifica la lista", async () => {
    const list = await createList(ana);
    const item = (await ana.post(`/api/lists/${list.id}/items`).send({ title: "Pan" })).body;
    await beto.get(`/api/lists/${list.id}`).expect(404);
    await beto.patch(`/api/lists/${list.id}`).send({ name: "Mía" }).expect(404);
    await beto.delete(`/api/lists/${list.id}`).expect(404);
    await beto.post(`/api/lists/${list.id}/items`).send({ title: "Intruso" }).expect(404);
    await beto.patch(`/api/lists/${list.id}/items/${item.id}`).send({ completed: true }).expect(404);
    await beto.delete(`/api/lists/${list.id}/items/${item.id}`).expect(404);
    await beto.get(`/api/lists/${list.id}/suggestions`).query({ q: "pa" }).expect(404);
    await beto.post(`/api/lists/${list.id}/locations`).send({ name: "Casa" }).expect(404);
    const me = (await beto.get("/api/me")).body;
    expect(me.lists.some((candidate: ListSummary) => candidate.id === list.id)).toBe(false);
    expect((await detail(ana, list.id)).items).toHaveLength(1);
  });

  it("responde 404 si la lista no existe", async () => {
    await ana.get("/api/lists/no-existe").expect(404);
  });
});

describe("ítems", () => {
  it("agrega arriba, completa, edita, reordena y elimina", async () => {
    const list = await createList(ana, { kind: "tasks" });
    const ids: string[] = [];
    for (const title of ["uno", "dos", "tres"]) {
      ids.push((await ana.post(`/api/lists/${list.id}/items`).send({ title }).expect(201)).body.id);
    }
    expect((await detail(ana, list.id)).items.map(({ title }) => title)).toEqual(["Tres", "Dos", "Uno"]);
    expect((await ana.get("/api/me")).body.lists.find((candidate: ListSummary) => candidate.id === list.id).pendingCount).toBe(3);

    const completed = await ana.patch(`/api/lists/${list.id}/items/${ids[0]}`).send({ completed: true }).expect(200);
    expect(completed.body.completed).toBe(true);
    const edited = await ana.patch(`/api/lists/${list.id}/items/${ids[1]}`).send({ title: "dos bis" }).expect(200);
    expect(edited.body.title).toBe("Dos bis");
    await ana.patch(`/api/lists/${list.id}/items/${ids[1]}`).send({ title: " " }).expect(400);
    await ana.patch(`/api/lists/${list.id}/items/no-existe`).send({ completed: true }).expect(404);

    await ana.post(`/api/lists/${list.id}/items/reorder`).send({ ids: [ids[1], ids[2], ids[0]] }).expect(200);
    const pending = (await detail(ana, list.id)).items.filter(({ completed: done }) => !done);
    expect(pending.map(({ title }) => title)).toEqual(["Dos bis", "Tres"]);

    await ana.delete(`/api/lists/${list.id}/items/${ids[2]}`).expect(204);
    expect((await detail(ana, list.id)).items).toHaveLength(2);
  });

  it("es idempotente con el id del cliente", async () => {
    const list = await createList(ana);
    const body = { id: "item-cliente", title: "Leche" };
    await ana.post(`/api/lists/${list.id}/items`).send(body).expect(201);
    await ana.post(`/api/lists/${list.id}/items`).send(body).expect(201);
    expect((await detail(ana, list.id)).items).toHaveLength(1);
  });

  it("archiva los completados más allá de los 5 más recientes", async () => {
    const list = await createList(ana, { kind: "checklist" });
    for (let index = 0; index < 7; index += 1) {
      const item = (await ana.post(`/api/lists/${list.id}/items`).send({ title: `Ítem ${index}` })).body;
      await ana.patch(`/api/lists/${list.id}/items/${item.id}`).send({ completed: true });
    }
    const items = (await detail(ana, list.id)).items;
    expect(items.filter(({ archivedAt }) => archivedAt === null)).toHaveLength(5);
  });
});

describe("ubicaciones", () => {
  it("son del dueño y se comparten entre sus listas", async () => {
    const shopping = await createList(ana);
    const tasks = await createList(ana, { kind: "tasks" });
    const place = (await ana.post(`/api/lists/${shopping.id}/locations`).send({ name: "Parcela" }).expect(201)).body;
    await ana.post(`/api/lists/${tasks.id}/locations`).send({ name: "parcela" }).expect(409);
    expect((await detail(ana, tasks.id)).locations.map(({ name }) => name)).toContain("Parcela");

    const item = (await ana.post(`/api/lists/${tasks.id}/items`).send({ title: "Podar", locationId: place.id })).body;
    expect(item.locationId).toBe(place.id);

    await ana.patch(`/api/lists/${tasks.id}/locations/${place.id}`).send({ name: "Campo" }).expect(200);
    await ana.delete(`/api/lists/${tasks.id}/locations/${place.id}`).expect(204);
    expect((await detail(ana, tasks.id)).items[0].locationId).toBeNull();
  });

  it("no acepta ubicaciones de otro dueño", async () => {
    const betoList = await createList(beto);
    const betoPlace = (await beto.post(`/api/lists/${betoList.id}/locations`).send({ name: "Oficina" })).body;
    const anaList = await createList(ana);
    const item = (await ana.post(`/api/lists/${anaList.id}/items`).send({ title: "Café", locationId: betoPlace.id })).body;
    expect(item.locationId).toBeNull();
    await ana.delete(`/api/lists/${anaList.id}/locations/${betoPlace.id}`).expect(404);
  });

  it("las checklist no usan ubicaciones", async () => {
    const shopping = await createList(ana);
    const place = (await ana.post(`/api/lists/${shopping.id}/locations`).send({ name: "Playa" })).body;
    const checklist = await createList(ana, { kind: "checklist" });
    const item = (await ana.post(`/api/lists/${checklist.id}/items`).send({ title: "Toalla", locationId: place.id })).body;
    expect(item.locationId).toBeNull();
    expect((await detail(ana, checklist.id)).locations).toEqual([]);
  });
});

describe("sugerencias", () => {
  it("combina el catálogo con lo usado por el mismo dueño, sin mezclar usuarios", async () => {
    const { agent: carla } = await loginAgent();
    const list = await createList(carla);
    await carla.post(`/api/lists/${list.id}/items`).send({ title: "Lechuga hidropónica" });
    const names = (await carla.get(`/api/lists/${list.id}/suggestions`).query({ q: "lech" })).body.map((s: { name: string }) => s.name);
    expect(names[0]).toBe("Lechuga hidropónica");
    expect(names).toContain("Leche");

    const betoList = await createList(beto);
    const betoNames = (await beto.get(`/api/lists/${betoList.id}/suggestions`).query({ q: "lech" })).body.map((s: { name: string }) => s.name);
    expect(betoNames).not.toContain("Lechuga hidropónica");
  });

  it("solo sugiere en listas de compras", async () => {
    const tasks = await createList(ana, { kind: "tasks" });
    expect((await ana.get(`/api/lists/${tasks.id}/suggestions`).query({ q: "lech" })).body).toEqual([]);
  });
});
