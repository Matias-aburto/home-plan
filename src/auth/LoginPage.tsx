import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, House } from "lucide-react";
import { useLocation } from "react-router";
import { api } from "../api/client";
import type { User } from "../types";

type AuthConfig = { googleClientId: string | null; devLogin: boolean };

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
      renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let googleScript: Promise<void> | null = null;

function loadGoogleScript() {
  googleScript ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScript = null;
      reject(new Error("No se pudo cargar Google."));
    };
    document.head.appendChild(script);
  });
  return googleScript;
}

export function LoginPage({
  canInstall,
  onInstall,
  onSignedIn
}: {
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onSignedIn: (user: User) => Promise<void>;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  // Tras iniciar sesión se queda en la misma URL, así que el enlace de invitación sigue funcionando.
  const invited = useLocation().pathname.startsWith("/invitacion/");
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState("");
  const [devEmail, setDevEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<AuthConfig>("/api/auth/config")
      .then(setConfig)
      .catch(() => setError(navigator.onLine
        ? "No pudimos conectar con Casa. Inténtalo nuevamente."
        : "Necesitas conexión para iniciar sesión."));
  }, []);

  useEffect(() => {
    const clientId = config?.googleClientId;
    if (!clientId) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            setSubmitting(true);
            try {
              const { user } = await api<{ user: User }>("/api/auth/google", {
                method: "POST",
                body: JSON.stringify({ credential })
              });
              await onSignedIn(user);
            } catch (requestError) {
              setError((requestError as Error).message);
            } finally {
              setSubmitting(false);
            }
          }
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          locale: "es",
          width: Math.min(320, buttonRef.current.clientWidth || 320)
        });
      })
      .catch((scriptError: Error) => setError(scriptError.message));
    return () => {
      cancelled = true;
    };
  }, [config?.googleClientId, onSignedIn]);

  async function devLogin(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { user } = await api<{ user: User }>("/api/auth/dev", {
        method: "POST",
        body: JSON.stringify({ email: devEmail })
      });
      await onSignedIn(user);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <header className="brand">
          <div className="brand-mark">
            <House size={27} strokeWidth={2.25} />
          </div>
          <span>Casa</span>
        </header>

        <div className="welcome-content animate-in">
          <div className="eyebrow">Tu hogar, más simple</div>
          <h1>Todo en casa,<br />en un solo lugar.</h1>
          <p>
            {invited
              ? "Te invitaron a Casa. Inicia sesión para ver la invitación."
              : "Tus listas y las de tu familia, sincronizadas en todos tus dispositivos."}
          </p>
          <div className="login-actions">
            {config?.googleClientId && <div className="google-button" ref={buttonRef} aria-busy={submitting} />}
            {config && !config.googleClientId && !config.devLogin && (
              <div className="form-error">El inicio de sesión no está configurado.</div>
            )}
            {config?.devLogin && (
              <form className="dev-login-form" onSubmit={devLogin}>
                <label htmlFor="dev-email">Entrar en modo desarrollo</label>
                <input
                  id="dev-email"
                  type="email"
                  value={devEmail}
                  onChange={(event) => setDevEmail(event.target.value)}
                  placeholder="tu@email.cl"
                  autoComplete="off"
                />
                <button className="secondary-button" disabled={submitting || !devEmail.trim()}>Entrar</button>
              </form>
            )}
            {error && <div className="form-error">{error}</div>}
          </div>
        </div>
        <footer>
          <span>Solo usamos tu nombre y tu email</span>
          {canInstall && (
            <button className="install-link" onClick={onInstall}>
              <Download size={15} /> Instalar Casa
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}
