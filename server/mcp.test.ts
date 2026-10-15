import request, { type Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

let ana: Agent;
let beto: Agent;
let anaPath: string;
let rpcId = 0;

beforeAll(async () => {
  await migrate();
  ana = (await loginAgent()).agent;
  beto = (await loginAgent()).agent;
  const created = await ana.post("/api/me/connections").send({ name: "Claude" }).expect(201);
  anaPath = new URL(created.body.url).pathname;
});

function rpc(path: string, method: string, params: Record<string, unknown> = {}) {
  return request(app)
    .post(path)
    .set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id: ++rpcId, method, params });
}

async function callTool(name: string, args: Record<string, unknown> = {}, path = anaPath) {
  const response = await rpc(path, "tools/call", { name, arguments: args }).expect(200);
  const content = response.body.result as { content: { text: string }[]; isError?: boolean };
  return { isError: Boolean(content.isError), text: content.content[0].text, data: content.isError ? null : JSON.parse(content.content[0].text) };
}

describe("conexiones", () => {
  it("lista y revoca conexiones; un token revocado deja de funcionar", async () => {
    const created = await beto.post("/api/me/connections").send({}).expect(201);
    const path = new URL(created.body.url).pathname;
    await rpc(path, "tools/list").expect(200);
    const connections = (await beto.get("/api/me/connections").expect(200)).body as { id: string; name: string }[];
    expect(connections.map(({ name }) => name)).toEqual(["Claude"]);
    await ana.delete(`/api/me/connections/${connections[0].id}`).expect(404);
    await beto.delete(`/api/me/connections/${connections[0].id}`).expect(204);
    await rpc(path, "tools/list").expect(401);
  });

  it("rechaza tokens inválidos y acepta el token como Bearer", async () => {
    await rpc("/api/mcp/no-existe", "tools/list").expect(401);
    const token = anaPath.split("/").pop();
    const response = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);
    expect(response.body.result.tools.map(({ name }: { name: string }) => name)).toContain("add_items");
  });
});

describe("listas por MCP", () => {
  it("crea una lista con ítems en el orden pedido y la app la ve", async () => {
    const { data } = await callTool("create_list", {
      name: "compras ferretería",
      icon: "hammer",
      items: ["Tubo PVC 110 mm", "Tapa gorro PVC 110 mm (x2)", "Adhesivo PVC"]
    });
    expect(data.list.name).toBe("Compras ferretería");
    const detail = (await ana.get(`/api/lists/${data.list.id}`).expect(200)).body;
    expect(detail.list.icon).toBe("hammer");
    expect(detail.items.map(({ title }: { title: string }) => title))
      .toEqual(["Tubo PVC 110 mm", "Tapa gorro PVC 110 mm (x2)", "Adhesivo PVC"]);
  });

  it("agrega y marca ítems en una lista existente", async () => {
    const list = (await ana.post("/api/lists").send({ name: "Supermercado" }).expect(201)).body;
    await ana.post(`/api/lists/${list.id}/items`).send({ title: "Pan" }).expect(201);
    const { data } = await callTool("add_items", { list_id: list.id, items: ["Leche", "Huevos"] });
    const viewed = await callTool("get_list", { list_id: list.id });
    expect(viewed.data.items.map(({ title }: { title: string }) => title)).toEqual(["Leche", "Huevos", "Pan"]);

    const marked = await callTool("set_items_completed", { list_id: list.id, item_ids: [data.items[0].id, "otro"] });
    expect(marked.data).toMatchObject({ updated: [{ title: "Leche", completed: true }], notFound: 1 });

    const lists = await callTool("list_lists");
    expect(lists.data.lists).toContainEqual(expect.objectContaining({ id: list.id, space: "Personal", pending: 2 }));
  });

  it("no toca listas ajenas", async () => {
    const list = (await beto.post("/api/lists").send({ name: "Privada" }).expect(201)).body;
    const result = await callTool("add_items", { list_id: list.id, items: ["Algo"] });
    expect(result.isError).toBe(true);
    expect((await beto.get(`/api/lists/${list.id}`).expect(200)).body.items).toEqual([]);
  });
});

describe("calendario por MCP", () => {
  it("crea eventos personales y de grupo, y los muestra por rango", async () => {
    const group = (await ana.post("/api/families").send({ name: "Casa" }).expect(201)).body;
    await callTool("create_event", { title: "Dentista", date: "2030-03-10", time: "09:30" });
    await callTool("create_event", { title: "Asado", date: "2030-03-12", group_id: group.id.toLowerCase() });
    await callTool("create_event", { title: "Cumpleaños Beto", date: "1990-03-11", yearly: true });

    const { data } = await callTool("list_events", { from: "2030-03-01", to: "2030-03-31" });
    expect(data.events.map(({ title, date, space }: Record<string, string>) => [title, date, space])).toEqual([
      ["Dentista", "2030-03-10", "Personal"],
      ["Cumpleaños Beto", "2030-03-11", "Personal"],
      ["Asado", "2030-03-12", "Casa"]
    ]);
    const events = (await ana.get("/api/calendar").expect(200)).body.events as { title: string }[];
    expect(events.map(({ title }) => title)).toContain("Asado");
  });

  it("rechaza fechas inválidas y grupos ajenos", async () => {
    expect((await callTool("create_event", { title: "X", date: "2030-02-30" })).isError).toBe(true);
    const other = (await beto.post("/api/families").send({ name: "Otra" }).expect(201)).body;
    expect((await callTool("create_event", { title: "X", date: "2030-02-10", group_id: other.id })).isError).toBe(true);
  });
});
