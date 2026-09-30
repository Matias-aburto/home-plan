import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

// Cada archivo de tests usa su propia base libSQL temporal y sin tiempo real.
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpdir(), `home-plan-test-${randomUUID()}.db`)}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.ABLY_API_KEY;

// Google no se contacta en tests: una credencial "ok:<email>" es válida y cualquier otra no.
vi.mock("../auth/google.js", () => ({
  googleClientId: "test-client-id",
  verifyGoogleCredential: async (credential: string) =>
    credential.startsWith("ok:")
      ? { sub: `google-${credential.slice(3)}`, email: credential.slice(3), name: "Persona Test", picture: null }
      : null
}));
