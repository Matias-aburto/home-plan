import { Router } from "express";
import { addTask, deleteTask, getTask, reorderTasks, updateTask } from "../db/tasks.js";
import { broadcast, type FamilyParams } from "../http/family.js";
import { capitalizeFirst, cleanText, readAssignee, readIdList } from "../http/validation.js";

export const tasksRouter = Router({ mergeParams: true });

tasksRouter.post<FamilyParams>("/", async (request, response) => {
  const title = capitalizeFirst(cleanText(request.body.title, 100));
  const assignee = readAssignee(request.body.assignee);
  const locationId = cleanText(request.body.locationId, 30) || null;
  const requestedId = cleanText(request.body.id, 50) || undefined;
  if (!title) return response.status(400).json({ message: "Escribe qué hay que hacer." });

  const task = await addTask(request.params.id, title, assignee, locationId, requestedId);
  await broadcast(request.params.id);
  return response.status(201).json(task);
});

tasksRouter.post<FamilyParams>("/reorder", async (request, response) => {
  const ids = readIdList(request.body.ids);
  if (ids.length === 0) return response.status(400).json({ message: "Indica el nuevo orden." });
  await reorderTasks(request.params.id, ids);
  await broadcast(request.params.id);
  return response.json({ ok: true });
});

tasksRouter.patch<FamilyParams & { taskId: string }>("/:taskId", async (request, response) => {
  const { id: familyId, taskId } = request.params;
  const body = request.body as Record<string, unknown>;
  const title = "title" in body ? capitalizeFirst(cleanText(body.title, 100)) : undefined;
  if ("title" in body && !title) {
    return response.status(400).json({ message: "Escribe qué hay que hacer." });
  }
  const updated = await updateTask(familyId, taskId, {
    completed: typeof body.completed === "boolean" ? body.completed : undefined,
    assignee: "assignee" in body ? readAssignee(body.assignee) : undefined,
    locationId: "locationId" in body ? cleanText(body.locationId, 30) || null : undefined,
    title
  });
  if (!updated) return response.status(404).json({ message: "No encontramos esa tarea." });
  await broadcast(familyId);
  return response.json(await getTask(familyId, taskId));
});

tasksRouter.delete<FamilyParams & { taskId: string }>("/:taskId", async (request, response) => {
  await deleteTask(request.params.id, request.params.taskId);
  await broadcast(request.params.id);
  return response.status(204).send();
});
