import { useState, type FormEvent } from "react";
import { ArrowLeft, Download, House, KeyRound, Users } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { AccountMenu } from "../components/AccountMenu";
import { useMe } from "../data/MeProvider";
import type { User } from "../types";

type View = "welcome" | "create" | "claim";

// Crear una familia nueva o reclamar una del modelo anterior con su código.
export function NewFamilyPage({
  user,
  canInstall,
  onInstall,
  onLogout
}: {
  user: User;
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onLogout: (everywhere?: boolean) => Promise<void>;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialCode = (params.get("codigo") || "").toUpperCase();
  const [view, setView] = useState<View>(initialCode ? "claim" : "welcome");
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const family = view === "create" ? await me.createFamily(name.trim()) : await me.claimFamily(code.trim());
      navigate(`/familias/${family.id}`, { replace: true });
    } catch (requestError) {
      setError(navigator.onLine ? (requestError as Error).message : "Necesitas conexión para esto.");
    } finally {
      setSubmitting(false);
    }
  }

  function changeView(next: View) {
    setError("");
    setView(next);
  }

  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <header className="brand">
          <div className="brand-mark">
            <House size={27} strokeWidth={2.25} />
          </div>
          <span>Casa</span>
          <div className="brand-account">
            <AccountMenu user={user} onLogout={onLogout} />
          </div>
        </header>

        {view === "welcome" ? (
          <div className="welcome-content animate-in">
            <div className="eyebrow">Familias</div>
            <h1>Organícense<br />juntos.</h1>
            <p>Una familia comparte listas y un calendario. Puedes ser parte de varias.</p>
            <div className="welcome-actions">
              <button className="primary-button" onClick={() => changeView("create")}>
                <Users size={19} /> Crear una familia
              </button>
              <button className="secondary-button" onClick={() => changeView("claim")}>
                <KeyRound size={19} /> Tengo un código de familia
              </button>
              <button className="text-button" onClick={() => navigate("/")}>
                Volver a mis listas
              </button>
            </div>
          </div>
        ) : (
          <div className="form-content animate-in">
            <button className="back-button" onClick={() => changeView("welcome")} aria-label="Volver">
              <ArrowLeft size={20} />
            </button>
            <div className="form-icon">{view === "create" ? <Users /> : <KeyRound />}</div>
            <h1>{view === "create" ? "Crea tu familia" : "Recupera tu familia"}</h1>
            <p>
              {view === "create"
                ? "Empieza con una lista de compras y otra de tareas."
                : "Si usaban Casa con un código, ingrésalo para quedar como dueño de esa familia y sus listas."}
            </p>
            <form onSubmit={submit}>
              <label htmlFor="family-input">{view === "create" ? "Nombre de la familia" : "Código familiar"}</label>
              <input
                id="family-input"
                value={view === "create" ? name : code}
                onChange={(event) => view === "create" ? setName(event.target.value) : setCode(event.target.value.toUpperCase())}
                placeholder={view === "create" ? "Ej. Familia González" : "Ej. A4B8K2MX"}
                maxLength={view === "create" ? 50 : 20}
                autoFocus
                autoComplete="off"
              />
              {error && <div className="form-error">{error}</div>}
              <button className="primary-button" disabled={submitting || !(view === "create" ? name : code).trim()}>
                {submitting ? "Un momento…" : view === "create" ? "Crear familia" : "Recuperar familia"}
              </button>
            </form>
          </div>
        )}
        <footer>
          <span>Conectado como {user.email}</span>
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
