import { OAuth2Client } from "google-auth-library";
import type { GoogleProfile } from "../db/users.js";

export const googleClientId = process.env.GOOGLE_CLIENT_ID || null;
const client = new OAuth2Client();

// Valida firma, emisor, audiencia y vencimiento del ID token que entrega Google Identity Services.
// Con `expectedNonce`, además exige que el token se haya pedido con ese nonce (flujo por redirección).
export async function verifyGoogleCredential(credential: string, expectedNonce?: string): Promise<GoogleProfile | null> {
  if (!googleClientId) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified) return null;
    if (expectedNonce !== undefined && payload.nonce !== expectedNonce) return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || null
    };
  } catch {
    return null;
  }
}
