export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Se emite cuando la API responde 401 para que la sesión se cierre en toda la app.
export const unauthorizedEvent = "casa:unauthorized";

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (response.status === 401 && !url.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event(unauthorizedEvent));
    }
    throw new ApiError(body.message || "Algo salió mal. Inténtalo nuevamente.", response.status);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
