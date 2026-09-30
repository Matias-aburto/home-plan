// En Vercel sin Turso (por ejemplo, previews sin variables) no hay base que migrar.
if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) {
  console.log("Sin TURSO_DATABASE_URL: se omiten las migraciones.");
} else {
  const { migrate } = await import("./db/migrations.js");
  await migrate();
  console.log("Base de datos inicializada correctamente.");
}
