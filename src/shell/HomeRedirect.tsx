import { Navigate } from "react-router";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { lastPathKey } from "./AppShell";

// Decide adónde llevar al abrir la app: última vista, primera lista o primera familia.
export function HomeRedirect() {
  const { loaded, lists, families } = useMe();
  if (!loaded) return <Loading />;

  const lastPath = localStorage.getItem(lastPathKey);
  const [, section, id] = lastPath?.split("/") ?? [];
  if (lastPath && section === "listas" && lists.some((list) => list.id === id)) return <Navigate to={lastPath} replace />;
  if (lastPath && section === "familias" && families.some((family) => family.id === id)) return <Navigate to={lastPath} replace />;

  const firstList = lists.find((list) => !list.archivedAt);
  if (firstList) return <Navigate to={`/listas/${firstList.id}`} replace />;
  if (families[0]) return <Navigate to={`/familias/${families[0].id}`} replace />;
  return <Navigate to="/personal" replace />;
}
