// Carga .env en desarrollo local. Se importa antes que el resto porque los módulos leen
// process.env al cargarse. En Vercel no hay .env y las variables vienen del proyecto.
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
