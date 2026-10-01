import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

const visitsKey = "casa:visits";
const visitCountedKey = "casa:visit-counted";
const dismissedKey = "casa:install-dismissed";
const minVisits = 2;

function readNumber(key: string) {
  return Number(localStorage.getItem(key) || 0);
}

// Sugerencia de instalar la app: aparece una sola vez, desde la segunda visita, y no vuelve si se descarta.
export function InstallPrompt({ canInstall, onInstall }: { canInstall: boolean; onInstall: () => Promise<void> }) {
  const [visits] = useState(() => {
    // Una visita por sesión del navegador, no por cada recarga.
    if (!sessionStorage.getItem(visitCountedKey)) {
      sessionStorage.setItem(visitCountedKey, "1");
      localStorage.setItem(visitsKey, String(readNumber(visitsKey) + 1));
    }
    return readNumber(visitsKey);
  });
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissedKey) === "1");

  // Si se instala por otro camino (menú del navegador), tampoco vuelve a aparecer.
  useEffect(() => {
    const onInstalled = () => localStorage.setItem(dismissedKey, "1");
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  if (!canInstall || dismissed || visits < minVisits) return null;

  function dismiss() {
    localStorage.setItem(dismissedKey, "1");
    setDismissed(true);
  }

  return (
    <div className="install-prompt" role="dialog" aria-label="Instalar Casa">
      <span className="install-prompt-icon"><Download size={18} /></span>
      <p><strong>Instala Casa en tu dispositivo</strong>Se abre como una app, más rápido y también sin conexión.</p>
      <div className="install-prompt-actions">
        <button className="text-button" onClick={dismiss}>Ahora no</button>
        <button className="primary-button" onClick={() => {
          dismiss();
          void onInstall();
        }}>Instalar</button>
      </div>
      <button className="install-prompt-close" onClick={dismiss} aria-label="Cerrar"><X size={16} /></button>
    </div>
  );
}
