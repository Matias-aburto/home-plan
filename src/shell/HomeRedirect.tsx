import { Navigate } from "react-router";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { useLegacyFamily } from "../family/LegacyFamilyProvider";
import { lastPathKey } from "./AppShell";

// Decide adónde llevar al abrir la app: enlace de invitación, última vista, familia o listas.
export function HomeRedirect() {
  const me = useMe();
  const legacy = useLegacyFamily();
  if (!me.loaded || legacy.loading) return <Loading />;

  if (new URLSearchParams(window.location.search).has("familia")) {
    return <Navigate to={legacy.family ? "/familia" : "/familia/unirse"} replace />;
  }
  const lastPath = localStorage.getItem(lastPathKey);
  if (lastPath?.startsWith("/listas/") && me.lists.some((list) => list.id === lastPath.split("/")[2])) {
    return <Navigate to={lastPath} replace />;
  }
  if (lastPath?.startsWith("/familia") && legacy.family) return <Navigate to={lastPath} replace />;
  if (legacy.family) return <Navigate to="/familia" replace />;
  const firstList = me.lists.find((list) => !list.archivedAt);
  return <Navigate to={firstList ? `/listas/${firstList.id}` : "/personal"} replace />;
}
