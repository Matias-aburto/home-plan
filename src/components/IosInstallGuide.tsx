import { Download, Plus, Share2, X } from "lucide-react";
import { appName, BrandIcon } from "../lib/brand";

export function IosInstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop install-guide-backdrop" onMouseDown={onClose}>
      <section className="install-guide animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="install-guide-icon"><Download size={23} /></div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <h2>Instala {appName}</h2>
        <p>En Safari, agrégala a tu inicio para abrirla como una app.</p>
        <ol>
          <li>
            <span><Share2 size={18} /></span>
            <div><strong>Abre Compartir</strong><small>Está en la barra de Safari.</small></div>
          </li>
          <li>
            <span><Plus size={18} /></span>
            <div><strong>Agregar a pantalla de inicio</strong><small>Desliza el menú si no aparece.</small></div>
          </li>
          <li>
            <span><BrandIcon size={18} /></span>
            <div><strong>Confirma con “Agregar”</strong><small>{appName} aparecerá junto a tus apps.</small></div>
          </li>
        </ol>
        <button className="primary-button" onClick={onClose}>Entendido</button>
      </section>
    </div>
  );
}
