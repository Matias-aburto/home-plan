import { useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, Trash2 } from "lucide-react";
import { api } from "../api/client";

type Connection = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}

// Enlaces MCP con que Claude lee y edita las listas y el calendario de la persona.
export function AssistantConnections({ onBack }: { onBack: () => void }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Connection[]>("/api/me/connections")
      .then(setConnections)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ connection: Connection; url: string }>("/api/me/connections", {
        method: "POST",
        body: JSON.stringify({ name: "Claude" })
      });
      setUrl(created.url);
      setCopied(false);
      setConnections((current) => [created.connection, ...(current ?? [])]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Claude dejará de tener acceso con este enlace. ¿Continuar?")) return;
    try {
      await api(`/api/me/connections/${id}`, { method: "DELETE" });
      setConnections((current) => current?.filter((connection) => connection.id !== id) ?? null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="assistant-connections">
      <button className="assistant-back" onClick={onBack}><ArrowLeft size={16} /> Volver</button>
      <h3>Conectar con Claude</h3>
      <p>
        Crea un enlace y agrégalo en Claude como conector personalizado (Configuración → Conectores).
        Después puedes pedirle cosas como "agrega esto a mi lista de compras" o "anota el dentista el martes a las 10".
      </p>
      {url ? (
        <div className="assistant-url">
          <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} aria-label="Enlace de conexión" />
          <button onClick={copy} aria-label="Copiar enlace">{copied ? <Check size={18} /> : <Copy size={18} />}</button>
        </div>
      ) : (
        <div className="account-actions">
          <button onClick={create} disabled={busy}>Crear enlace</button>
        </div>
      )}
      {url && <p className="assistant-warning">Cópialo ahora: no se vuelve a mostrar. Quien tenga el enlace puede ver y editar tus listas y tu calendario.</p>}
      {error && <p className="assistant-warning">{error}</p>}
      {connections && connections.length > 0 && (
        <ul className="assistant-list">
          {connections.map((connection) => (
            <li key={connection.id}>
              <div>
                <strong>{connection.name}</strong>
                <span>
                  Creado el {formatDate(connection.createdAt)}
                  {connection.lastUsedAt ? ` · usado el ${formatDate(connection.lastUsedAt)}` : " · sin usar"}
                </span>
              </div>
              <button onClick={() => revoke(connection.id)} aria-label="Revocar enlace"><Trash2 size={17} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
