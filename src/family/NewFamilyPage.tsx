import { useState, type FormEvent } from "react";
import { ArrowLeft, Download, Users } from "lucide-react";
import { useNavigate } from "react-router";
import { AccountMenu } from "../components/AccountMenu";
import { appName, BrandIcon } from "../lib/brand";
import { useMe } from "../data/MeProvider";
import type { User } from "../types";

// Crear un grupo nuevo. Para entrar a uno existente se necesita una invitación.
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
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const family = await me.createFamily(name.trim());
      navigate(`/grupos/${family.id}`, { replace: true });
    } catch (requestError) {
      setError(navigator.onLine ? (requestError as Error).message : "Necesitas conexión para esto.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <header className="brand">
          <div className="brand-mark">
            <BrandIcon size={27} />
          </div>
          <span>{appName}</span>
          <div className="brand-account">
            <AccountMenu user={user} onLogout={onLogout} />
          </div>
        </header>

        <div className="form-content animate-in">
          <button className="back-button" onClick={() => navigate("/")} aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div className="form-icon"><Users /></div>
          <h1>Crea un grupo</h1>
          <p>
            Para tu familia, tus amigos, un depto compartido o un viaje. Empieza vacío: después creas
            las listas y calendarios que necesiten e invitas a los demás. Para entrar a un grupo
            existente, pide que te inviten.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="family-input">Nombre del grupo</label>
            <input
              id="family-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej. Viaje a Pucón"
              maxLength={50}
              autoFocus
              autoComplete="off"
            />
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button" disabled={submitting || !name.trim()}>
              {submitting ? "Un momento…" : "Crear grupo"}
            </button>
          </form>
        </div>
        <footer>
          <span>Conectado como {user.email}</span>
          {canInstall && (
            <button className="install-link" onClick={onInstall}>
              <Download size={15} /> Instalar {appName}
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}
