import { CloudOff, RefreshCw } from "lucide-react";
import { useConnection } from "../data/ConnectionProvider";
import { useSustained } from "../hooks/useSustained";

const sustainMs = 5000;

// Solo aparece cuando algo no está normal. Guardar un cambio tarda un instante: eso no se muestra.
export function SyncStatus() {
  const { online, connected, everConnected, pendingCount } = useConnection();
  const slowSync = useSustained(online && pendingCount > 0, sustainMs);
  const lostRealtime = useSustained(online && everConnected && !connected, sustainMs);

  if (!online) {
    return (
      <span className="sync-pill offline" role="status" title="Lo que hagas se guarda en este dispositivo y se envía al volver la conexión.">
        <CloudOff size={14} />
        Sin conexión{pendingCount ? ` · ${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}` : ""}
      </span>
    );
  }
  if (slowSync) {
    return (
      <span className="sync-pill" role="status" title="Enviando cambios guardados en este dispositivo.">
        <RefreshCw size={14} className="spin" />
        Sincronizando · {pendingCount}
      </span>
    );
  }
  if (lostRealtime) {
    return (
      <span className="sync-pill" role="status" title="Los cambios de otras personas pueden tardar en aparecer.">
        <RefreshCw size={14} className="spin" />
        Reconectando
      </span>
    );
  }
  return null;
}
