import { Navigate } from "react-router";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { lastPathKey } from "./AppShell";

// Decide adónde llevar al abrir la app: la última vista o, si no hay, el inicio.
export function HomeRedirect() {
  const { loaded, lists, families } = useMe();
  if (!loaded) return <Loading />;

  // Las rutas antiguas (/familias/...) se guardaron antes del cambio a grupos.
  const lastPath = localStorage.getItem(lastPathKey)?.replace(/^\/familias\//, "/grupos/") ?? null;
  const [, section, id] = lastPath?.split("/") ?? [];
  if (lastPath && section === "listas" && lists.some((list) => list.id === id)) return <Navigate to={lastPath} replace />;
  if (lastPath === "/calendario" || lastPath === "/inicio") return <Navigate to={lastPath} replace />;
  if (lastPath && section === "grupos" && families.some((family) => family.id === id)) return <Navigate to={lastPath} replace />;

  return <Navigate to="/inicio" replace />;
}
