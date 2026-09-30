import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

// Cada archivo de tests usa su propia base libSQL temporal y sin tiempo real.
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpdir(), `home-plan-test-${randomUUID()}.db`)}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.ABLY_API_KEY;
