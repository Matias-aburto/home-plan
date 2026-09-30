import { useState, type FormEvent } from "react";
import { ArrowLeft, Download, House, LogIn, Users } from "lucide-react";
import { api } from "../api/client";
import type { Family, View } from "../types";

export function Onboarding({
  view,
  error,
  canInstall,
  onInstall,
  onViewChange,
  onError,
  onEnter
}: {
  view: View;
  error: string;
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onViewChange: (view: View) => void;
  onError: (message: string) => void;
  onEnter: (family: Family) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createFamily(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      onEnter(
        await api<Family>("/api/families", {
          method: "POST",
          body: JSON.stringify({ name })
        })
      );
    } catch (requestError) {
      onError((requestError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function joinFamily(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      onEnter(await api<Family>(`/api/families/${code.trim().toUpperCase()}`));
    } catch (requestError) {
      onError((requestError as Error).message);
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

        {view === "welcome" ? (
          <div className="welcome-content animate-in">
            <div className="eyebrow">Tu hogar, más simple</div>
            <h1>Todo en casa,<br />en un solo lugar.</h1>
            <p>Listas compartidas para organizarse juntos.</p>
            <div className="welcome-actions">
              <button className="primary-button" onClick={() => onViewChange("create")}>
                <Users size={19} /> Crear una familia
              </button>
              <button className="secondary-button" onClick={() => onViewChange("join")}>
                <LogIn size={19} /> Unirme con un código
              </button>
            </div>
          </div>
        ) : (
          <div className="form-content animate-in">
            <button className="back-button" onClick={() => onViewChange("welcome")} aria-label="Volver">
              <ArrowLeft size={20} />
            </button>
            <div className="form-icon">{view === "create" ? <Users /> : <LogIn />}</div>
            <h1>{view === "create" ? "Crea tu familia" : "Únete a tu familia"}</h1>
            <p>{view === "create" ? "Podrás invitar a los demás después." : "Ingresa el código que compartieron contigo."}</p>
            <form onSubmit={view === "create" ? createFamily : joinFamily}>
              <label htmlFor="family-input">{view === "create" ? "Nombre de la familia" : "Código familiar"}</label>
              <input
                id="family-input"
                value={view === "create" ? name : code}
                onChange={(event) =>
                  view === "create" ? setName(event.target.value) : setCode(event.target.value.toUpperCase())
                }
                placeholder={view === "create" ? "Ej. Familia González" : "Ej. A4B8K2MX"}
                maxLength={view === "create" ? 50 : 8}
                autoFocus
                autoComplete="off"
              />
              {error && <div className="form-error">{error}</div>}
              <button className="primary-button" disabled={submitting}>
                {submitting ? "Un momento…" : view === "create" ? "Crear familia" : "Entrar"}
              </button>
            </form>
          </div>
        )}
        <footer>
          <span>Sin cuentas por ahora · Comparte solo con tu hogar</span>
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
