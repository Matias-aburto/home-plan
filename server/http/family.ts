import type { NextFunction, Request, Response } from "express";
import { getMembership, roleAtLeast } from "../db/families.js";
import type { FamilyRole } from "../db/types.js";
import { currentUser } from "./session.js";

export type FamilyParams = { id: string };

export const familyNotFound = { message: "No encontramos esa familia." };

export function currentRole(response: Response) {
  return response.locals.familyRole as FamilyRole;
}

// Exige ser miembro con al menos `required`. A quien no es miembro se le responde 404
// para no revelar que la familia existe.
export function requireMember(required: FamilyRole = "member") {
  return async (request: Request<FamilyParams>, response: Response, next: NextFunction) => {
    const role = await getMembership(request.params.id, currentUser(response).id);
    if (!role) return response.status(404).json(familyNotFound);
    if (!roleAtLeast(role, required)) {
      return response.status(403).json({ message: "No tienes permiso para hacer esto en la familia." });
    }
    response.locals.familyRole = role;
    next();
  };
}
