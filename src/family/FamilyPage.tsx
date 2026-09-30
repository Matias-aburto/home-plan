import { useState } from "react";
import { Navigate, useLocation } from "react-router";
import { CalendarSection } from "../calendar/CalendarSection";
import { Loading } from "../components/Loading";
import { useSortMode } from "../hooks/useSortMode";
import { familyPaths } from "../shell/navigation";
import { ShoppingSection } from "../shopping/ShoppingSection";
import { TasksSection } from "../tasks/TasksSection";
import { LocationManager } from "./LocationManager";
import { useLegacyFamily } from "./LegacyFamilyProvider";

// Secciones de la familia a la que se entra con código: compras, tareas y calendario.
export function FamilyPage() {
  const { pathname } = useLocation();
  const { family, loading, mutate, refresh } = useLegacyFamily();
  const [managingLocations, setManagingLocations] = useState(false);
  const familyKey = family?.id ?? "";
  const [sortMode, setSortMode] = useSortMode(`sort:shopping:${familyKey}`);
  const [taskSortMode, setTaskSortMode] = useSortMode(`sort:tasks:${familyKey}`);

  if (loading) return <Loading />;
  if (!family) return <Navigate to="/familia/unirse" replace />;

  const section = pathname.startsWith(familyPaths.tasks) ? "tasks"
    : pathname.startsWith(familyPaths.calendar) ? "calendar" : "shopping";

  return (
    <>
      {/* Compras queda montada al cambiar de sección para no perder lo que se estaba escribiendo. */}
      <ShoppingSection
        family={family}
        hidden={section !== "shopping"}
        sortMode={sortMode}
        onSortChange={setSortMode}
        onMutate={mutate}
        onManageLocations={() => setManagingLocations(true)}
      />
      {section === "tasks" && (
        <TasksSection
          family={family}
          sortMode={taskSortMode}
          onSortChange={setTaskSortMode}
          onMutate={mutate}
          onManageLocations={() => setManagingLocations(true)}
        />
      )}
      {section === "calendar" && <CalendarSection family={family} onMutate={mutate} />}
      {managingLocations && (
        <LocationManager
          family={family}
          sortMode={section === "tasks" ? taskSortMode : sortMode}
          onSortChange={section === "tasks" ? setTaskSortMode : setSortMode}
          onChanged={refresh}
          onClose={() => setManagingLocations(false)}
        />
      )}
    </>
  );
}
