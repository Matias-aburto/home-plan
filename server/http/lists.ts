import type { NextFunction, Request, Response } from "express";
import { hasAccess, listAccess } from "../auth/access.js";
import { getListRecord } from "../db/lists.js";
import type { ListAccess, ListRecord } from "../db/types.js";
import { notifyFamilyChanged, notifyUserChanged } from "../realtime.js";
import { currentUser } from "./session.js";

export type ListParams = { listId: string };

export const listNotFound = { message: "No encontramos esa lista." };

export function currentList(response: Response) {
  return response.locals.list as ListRecord;
}

export function currentAccess(response: Response) {
  return response.locals.access as Exclude<ListAccess, "none">;
}

// Carga la lista y el acceso del usuario. Sin acceso responde 404 para no revelar que existe.
export async function loadList(request: Request<ListParams>, response: Response, next: NextFunction) {
  const list = await getListRecord(request.params.listId);
  const access = list ? await listAccess(currentUser(response), list) : "none";
  if (!list || access === "none") return response.status(404).json(listNotFound);
  response.locals.list = list;
  response.locals.access = access;
  next();
}

export function requireAccess(required: Exclude<ListAccess, "none">) {
  return (_request: Request, response: Response, next: NextFunction) => {
    if (!hasAccess(currentAccess(response), required)) {
      return response.status(403).json({ message: "No tienes permiso para hacer esto en la lista." });
    }
    next();
  };
}

// Avisa a quienes ven la lista que cambió: al dueño o a toda la familia.
export async function broadcastList(list: ListRecord) {
  if (list.ownerUserId) await notifyUserChanged(list.ownerUserId, { listId: list.id });
  if (list.familyId) await notifyFamilyChanged(list.familyId, { listId: list.id });
}
