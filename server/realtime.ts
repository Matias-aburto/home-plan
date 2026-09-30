import Ably from "ably";

const apiKey = process.env.ABLY_API_KEY;
const rest = apiKey ? new Ably.Rest({ key: apiKey }) : null;

export const realtimeEnabled = rest !== null;

export function familyChannel(familyId: string) {
  return `family:${familyId.toUpperCase()}`;
}

// Solo avisa que algo cambió; el cliente vuelve a pedir los datos a la API.
export async function notifyFamilyChanged(familyId: string) {
  if (!rest) return;
  try {
    await rest.channels.get(familyChannel(familyId)).publish("family:changed", null);
  } catch (error) {
    console.error("No se pudo publicar en Ably", error);
  }
}

export async function createFamilyTokenRequest(familyId: string) {
  if (!rest) return null;
  return rest.auth.createTokenRequest({
    capability: { [familyChannel(familyId)]: ["subscribe"] }
  });
}
