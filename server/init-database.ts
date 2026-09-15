import { HomeRepository } from "./database.js";

const repository = new HomeRepository();
await repository.initialize();
console.log("Base de datos inicializada correctamente.");
