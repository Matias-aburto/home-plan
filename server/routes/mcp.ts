import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router, type Request, type Response } from "express";
import { resolveApiToken } from "../db/apiTokens.js";
import { createMcpServer } from "../mcp/server.js";

// Endpoint MCP (Streamable HTTP sin estado: sirve en funciones serverless). Se autentica con un token
// de conexión, en el header Authorization (Claude Code) o en la URL (conectores de claude.ai, que no
// permiten headers propios). No usa la cookie de sesión, así que no aplica el chequeo de origen.
export const mcpRouter = Router();

async function handle(token: string | null, request: Request, response: Response) {
  const user = token ? await resolveApiToken(token) : null;
  if (!user) {
    return response.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Conexión no válida o revocada. Genera una nueva en Home Plan." },
      id: null
    });
  }
  const server = createMcpServer(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
}

function bearer(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.get("authorization") || "");
  return match ? match[1] : null;
}

// Sin sesiones no hay flujo de notificaciones del servidor (GET) ni sesión que cerrar (DELETE).
function notAllowed(_request: Request, response: Response) {
  response.setHeader("Allow", "POST");
  return response.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Método no permitido." }, id: null });
}

mcpRouter.post("/", (request, response) => handle(bearer(request), request, response));
mcpRouter.post("/:token", (request, response) => handle(request.params.token, request, response));
mcpRouter.all("/", notAllowed);
mcpRouter.all("/:token", notAllowed);
