import { Router } from "express";
import { baseCatalog } from "../catalog.js";
import { normalizeText } from "../db/client.js";
import { createFamily, getFamily } from "../db/families.js";
import { getLearnedProducts } from "../db/items.js";
import { familyNotFound, requireFamily, type FamilyParams } from "../http/family.js";
import { cleanText } from "../http/validation.js";
import { createFamilyTokenRequest } from "../realtime.js";

export const familiesRouter = Router();

familiesRouter.post("/", async (request, response) => {
  const name = cleanText(request.body.name, 50);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para tu familia." });
  return response.status(201).json(await createFamily(name));
});

familiesRouter.get<FamilyParams>("/:id", async (request, response) => {
  const family = await getFamily(request.params.id);
  if (!family) return response.status(404).json(familyNotFound);
  return response.json(family);
});

familiesRouter.get<FamilyParams>("/:id/realtime-token", requireFamily, async (request, response) => {
  const tokenRequest = await createFamilyTokenRequest(request.params.id);
  if (!tokenRequest) return response.status(503).json({ message: "El tiempo real no está configurado." });
  return response.json(tokenRequest);
});

// Combina el catálogo base con lo que la familia ya compró antes (esto último pesa más).
familiesRouter.get<FamilyParams>("/:id/suggestions", requireFamily, async (request, response) => {
  const query = normalizeText(cleanText(request.query.q, 80));
  if (query.length < 2) return response.json([]);

  const suggestions = new Map<string, { name: string; category: string; score: number }>();
  for (const product of baseCatalog) {
    const normalizedName = normalizeText(product.name);
    if (!normalizedName.includes(query)) continue;
    suggestions.set(normalizedName, {
      ...product,
      score: normalizedName.startsWith(query) ? 100 : 50
    });
  }
  for (const product of await getLearnedProducts(request.params.id, query)) {
    const normalizedName = normalizeText(product.name);
    const existing = suggestions.get(normalizedName);
    suggestions.set(normalizedName, {
      name: product.name,
      category: existing?.category || "Usado antes",
      score: (normalizedName.startsWith(query) ? 200 : 150) + Math.min(product.uses, 20)
    });
  }

  return response.json(
    [...suggestions.values()]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"))
      .slice(0, 6)
      .map(({ name, category }) => ({ name, category }))
  );
});
