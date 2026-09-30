import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "./app.js";
import { migrate } from "./db/migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3001;

// En Vercel las migraciones corren en el build; localmente se aplican al arrancar.
await migrate();

const distDirectory = path.join(__dirname, "../dist");
app.use(express.static(distDirectory));
app.get("/{*splat}", (_request, response) => response.sendFile(path.join(distDirectory, "index.html")));

app.listen(port, "0.0.0.0", () => {
  console.log(`Casa está disponible en http://localhost:${port}`);
});
