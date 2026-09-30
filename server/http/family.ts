import type { NextFunction, Request, Response } from "express";
import { familyExists } from "../db/families.js";
import { notifyFamilyChanged } from "../realtime.js";

export type FamilyParams = { id: string };

export const familyNotFound = { message: "No encontramos esa familia." };

// Responde 404 antes de llegar a las rutas anidadas si la familia no existe.
export async function requireFamily(request: Request<FamilyParams>, response: Response, next: NextFunction) {
  if (!(await familyExists(request.params.id))) return response.status(404).json(familyNotFound);
  next();
}

export async function broadcast(familyId: string) {
  await notifyFamilyChanged(familyId);
}
