import { createClient, type Client, type InValue } from "@libsql/client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const localDataDirectory = path.join(__dirname, "../../data");
export const databaseUrl = process.env.TURSO_DATABASE_URL || `file:${path.join(localDataDirectory, "home-plan.db")}`;

export const db: Client = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN
});

export function value(input: unknown): InValue {
  return input === undefined ? null : input as InValue;
}

export function text(input: unknown) {
  return input === null || input === undefined ? null : String(input);
}

export function normalizeText(input: string) {
  return input.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

export function familyKey(familyId: string) {
  return familyId.toUpperCase();
}
