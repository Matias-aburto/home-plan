import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, unauthorizedEvent } from "../api/client";
import { clearOfflineData, getPendingOperations } from "../offline";
import type { User } from "../types";

type Session = {
  status: "loading" | "anonymous" | "authenticated";
  user: User | null;
  signIn: (user: User) => Promise<void>;
  logout: (everywhere?: boolean) => Promise<void>;
};

const cachedUserKey = "casa:user";
const SessionContext = createContext<Session | null>(null);

function readCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(cachedUserKey) || "null") as User | null;
  } catch {
    return null;
  }
}

// Borra todo lo que el usuario dejó en este dispositivo.
async function clearDeviceData() {
  localStorage.removeItem(cachedUserKey);
  localStorage.removeItem("familyId");
  await clearOfflineData();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Session["status"]>("loading");

  // Si entra otra cuenta, no hereda la caché ni la cola offline de la anterior (se avisa si se pierde algo).
  const signIn = useCallback(async (nextUser: User) => {
    const previous = readCachedUser();
    if (previous && previous.id !== nextUser.id) {
      const discarded = (await getPendingOperations()).length;
      await clearDeviceData();
      if (discarded) {
        sessionStorage.setItem("casa:notice", `Se descartaron ${discarded} cambio${discarded === 1 ? "" : "s"} sin sincronizar de ${previous.email}.`);
      }
    }
    localStorage.setItem(cachedUserKey, JSON.stringify(nextUser));
    setUser(nextUser);
    setStatus("authenticated");
  }, []);

  // Sesión vencida: se pide login, pero se conservan los cambios pendientes para el mismo usuario.
  const expire = useCallback(() => {
    setUser(null);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    api<{ user: User }>("/api/me")
      .then(({ user: nextUser }) => signIn(nextUser))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          expire();
          return;
        }
        // Sin conexión: se usa la última sesión conocida y se valida al reconectar.
        const cached = readCachedUser();
        if (cached) {
          setUser(cached);
          setStatus("authenticated");
        } else {
          setStatus("anonymous");
        }
      });
  }, [signIn, expire]);

  useEffect(() => {
    window.addEventListener(unauthorizedEvent, expire);
    return () => window.removeEventListener(unauthorizedEvent, expire);
  }, [expire]);

  const logout = useCallback(async (everywhere = false) => {
    await api(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await clearDeviceData();
    expire();
  }, [expire]);

  return (
    <SessionContext.Provider value={{ status, user, signIn, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession debe usarse dentro de AuthProvider");
  return session;
}
