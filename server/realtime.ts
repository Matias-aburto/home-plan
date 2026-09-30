import Ably from "ably";

const apiKey = process.env.ABLY_API_KEY;
const rest = apiKey ? new Ably.Rest({ key: apiKey }) : null;

export const realtimeEnabled = rest !== null;

export function familyChannel(familyId: string) {
  return `family:${familyId.toUpperCase()}`;
}

export function userChannel(userId: string) {
  return `user:${userId}`;
}

// Los mensajes solo avisan qué cambió; el cliente vuelve a pedir los datos a la API.
async function publish(channel: string, name: string, data: unknown) {
  if (!rest) return;
  try {
    await rest.channels.get(channel).publish(name, data);
  } catch (error) {
    console.error("No se pudo publicar en Ably", error);
  }
}

export async function notifyFamilyChanged(familyId: string) {
  await publish(familyChannel(familyId), "family:changed", null);
}

export async function notifyUserChanged(userId: string, data: { listId?: string } = {}) {
  await publish(userChannel(userId), "me:changed", data);
}

// Token de solo lectura para los canales que el usuario puede escuchar.
export async function createTokenRequest(channels: string[]) {
  if (!rest) return null;
  return rest.auth.createTokenRequest({
    capability: Object.fromEntries(channels.map((channel) => [channel, ["subscribe"]]))
  });
}
