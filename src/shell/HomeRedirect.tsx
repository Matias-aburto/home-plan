import { Navigate } from "react-router";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { lastPathKey } from "./AppShell";

// Decide adónde llevar al abrir la app: última vista, primera lista o primer grupo.
export function HomeRedirect() {
  const { loaded, lists, calendars, families } = useMe();
  if (!loaded) return <Loading />;

  // Las rutas antiguas (/familias/...) se guardaron antes del cambio a grupos.
  const lastPath = localStorage.getItem(lastPathKey)?.replace(/^\/familias\//, "/grupos/") ?? null;
  const [, section, id] = lastPath?.split("/") ?? [];
  if (lastPath && section === "listas" && lists.some((list) => list.id === id)) return <Navigate to={lastPath} replace />;
  if (lastPath && section === "calendarios" && calendars.some((calendar) => calendar.id === id)) {
    return <Navigate to={lastPath} replace />;
  }
  if (lastPath && section === "grupos" && families.some((family) => family.id === id)) return <Navigate to={lastPath} replace />;

  const firstList = lists.find((list) => !list.archivedAt);
  if (firstList) return <Navigate to={`/listas/${firstList.id}`} replace />;
  if (families[0]) return <Navigate to={`/grupos/${families[0].id}`} replace />;
  return <Navigate to="/personal" replace />;
}
