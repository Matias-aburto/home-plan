import { useMemo, useState, type FormEvent } from "react";
import { Check, House, ListTodo, MapPin, Plus, Settings2, UserRound, Users } from "lucide-react";
import { api } from "../api/client";
import { EntryEditModal } from "../components/EntryEditModal";
import { SortableList } from "../components/SortableList";
import { archiveCompletedLocally, mergeVisibleOrder, nextListPosition, sortCompleted, sortPending, withPendingPositions } from "../lib/listOrder";
import { capitalizeFirst } from "../lib/text";
import { TaskRow } from "./TaskRow";
import type { Assignee, Family, HouseholdTask, OfflineMutation, SortMode } from "../types";

export function TasksSection({
  family,
  sortMode,
  onSortChange,
  onMutate,
  onManageLocations
}: {
  family: Family;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onMutate: (family: Family, operation: OfflineMutation) => Promise<void>;
  onManageLocations: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<Assignee | null>(null);
  const [locationId, setLocationId] = useState("");
  const [filter, setFilter] = useState<"all" | "none" | Assignee>("all");
  const [adding, setAdding] = useState(false);
  const [choosingOptions, setChoosingOptions] = useState(false);
  const [editingTask, setEditingTask] = useState<HouseholdTask | null>(null);
  const selectedLocation = family.locations.find(({ id }) => id === locationId);
  const visibleTasks = useMemo(
    () => family.tasks.filter((task) =>
      !task.archivedAt && (filter === "all" || (filter === "none" ? !task.assignee : task.assignee === filter))
    ),
    [family.tasks, filter]
  );
  const pendingTasks = useMemo(
    () => sortPending(visibleTasks.filter((task) => !task.completed), sortMode, (task) => task.title),
    [visibleTasks, sortMode]
  );
  const completedTasks = useMemo(
    () => sortCompleted(visibleTasks.filter((task) => task.completed)),
    [visibleTasks]
  );

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const now = new Date().toISOString();
      const formattedTitle = capitalizeFirst(title);
      const task: HouseholdTask = {
        id: crypto.randomUUID(),
        title: formattedTitle,
        assignee,
        locationId: locationId || null,
        completed: false,
        position: nextListPosition(family.tasks),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null
      };
      await onMutate({ ...family, tasks: [task, ...family.tasks] }, {
        url: `/api/families/${family.id}/tasks`,
        method: "POST",
        body: { id: task.id, title: task.title, assignee, locationId: task.locationId }
      });
      setTitle("");
    } finally {
      setAdding(false);
    }
  }

  async function toggleTask(task: HouseholdTask) {
    const completed = !task.completed;
    const now = new Date().toISOString();
    const tasks = archiveCompletedLocally(family.tasks.map((candidate) =>
      candidate.id === task.id
        ? { ...candidate, completed, updatedAt: now, completedAt: completed ? now : null, archivedAt: null }
        : candidate
    ));
    await onMutate({ ...family, tasks }, {
      url: `/api/families/${family.id}/tasks/${task.id}`,
      method: "PATCH",
      body: { completed }
    });
  }

  async function deleteTask(task: HouseholdTask) {
    await onMutate({ ...family, tasks: family.tasks.filter(({ id }) => id !== task.id) }, {
      url: `/api/families/${family.id}/tasks/${task.id}`,
      method: "DELETE"
    });
  }

  async function editTask(
    task: HouseholdTask,
    nextTitle: string,
    nextLocationId: string | null,
    nextAssignee: Assignee | null
  ) {
    const formattedTitle = capitalizeFirst(nextTitle);
    const updatedAt = new Date().toISOString();
    await onMutate({
      ...family,
      tasks: family.tasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              title: formattedTitle,
              locationId: nextLocationId,
              assignee: nextAssignee,
              updatedAt
            }
          : candidate
      )
    }, {
      url: `/api/families/${family.id}/tasks/${task.id}`,
      method: "PATCH",
      body: { title: formattedTitle, locationId: nextLocationId, assignee: nextAssignee }
    });
    setEditingTask(null);
  }

  async function reorderTasks(visibleIds: string[]) {
    const allPending = sortPending(
      family.tasks.filter((task) => !task.completed && !task.archivedAt),
      sortMode,
      (task) => task.title
    );
    onSortChange("custom");
    const merged = mergeVisibleOrder(allPending, visibleIds);
    await onMutate({ ...family, tasks: withPendingPositions(family.tasks, merged) }, {
      url: `/api/families/${family.id}/tasks/reorder`,
      method: "POST",
      body: { ids: merged.map((task) => task.id) }
    });
  }

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only">
          <h2>Cosas por hacer</h2>
        </div>
        <span>{pendingTasks.length} {pendingTasks.length === 1 ? "pendiente" : "pendientes"}</span>
      </div>

      <form className="add-item-form task-form" onSubmit={addTask}>
        <div className="add-item-fields">
          <button className="mobile-location-button" type="button" onClick={() => setChoosingOptions(true)}>
            <Settings2 size={15} />
            <span>{selectedLocation?.name || assignee || "Detalles"}</span>
          </button>
          <div className="item-input-wrap">
            <Plus size={20} />
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Agregar una tarea"
              aria-label="Tarea"
              maxLength={100}
            />
          </div>
          <button className="add-button" disabled={adding || !title.trim()}>
            <Plus size={19} /><span>Agregar</span>
          </button>
        </div>
        <div className="task-options-picker">
          <div className="location-picker">
            <span>Asignar a</span>
            <button type="button" className={!assignee ? "selected" : ""} onClick={() => setAssignee(null)}>
              Sin asignar
            </button>
            {(["Matías", "Francisca"] as Assignee[]).map((member) => (
              <button
                type="button"
                key={member}
                className={assignee === member ? "selected" : ""}
                onClick={() => setAssignee(member)}
              >
                <UserRound size={13} /> {member}
              </button>
            ))}
          </div>
          <div className="location-picker">
            <span>En</span>
            <button type="button" className={!locationId ? "selected" : ""} onClick={() => setLocationId("")}>
              General
            </button>
            {family.locations.map((location) => (
              <button
                type="button"
                key={location.id}
                className={locationId === location.id ? "selected" : ""}
                onClick={() => setLocationId(location.id)}
              >
                <MapPin size={13} /> {location.name}
              </button>
            ))}
            <button type="button" className="manage-task-locations" onClick={onManageLocations} aria-label="Administrar ubicaciones">
              <Settings2 size={14} />
            </button>
          </div>
        </div>
      </form>

      <div className="list-toolbar task-toolbar">
        <div className="filter-chips">
          <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button>
          {(["Matías", "Francisca"] as Assignee[]).map((member) => (
            <button key={member} className={filter === member ? "selected" : ""} onClick={() => setFilter(member)}>
              {member}
            </button>
          ))}
          <button className={filter === "none" ? "selected" : ""} onClick={() => setFilter("none")}>Sin asignar</button>
        </div>
        <button className="manage-locations-button" onClick={onManageLocations} aria-label="Ajustes de la lista">
          <Settings2 size={17} />
        </button>
      </div>

      <div className="shopping-list">
        {pendingTasks.length === 0 && completedTasks.length === 0 ? (
          <div className="empty-state animate-in">
            <div><ListTodo size={28} /></div>
            <h3>No hay tareas por aquí</h3>
            <p>Agrega algo que haya que hacer en casa.</p>
          </div>
        ) : (
          <>
            {pendingTasks.length > 0 && (
              <SortableList
                items={pendingTasks}
                onReorder={reorderTasks}
                renderItem={(task, dragHandle) => (
                  <TaskRow
                    task={task}
                    locations={family.locations}
                    dragHandle={dragHandle}
                    onToggle={toggleTask}
                    onEdit={setEditingTask}
                    onDelete={deleteTask}
                  />
                )}
              />
            )}
            {completedTasks.length > 0 && (
              <div className="completed-section">
                <h3>Completadas · {completedTasks.length}</h3>
                {completedTasks.map((task) => (
                  <TaskRow key={task.id} task={task} locations={family.locations} onToggle={toggleTask} onEdit={setEditingTask} onDelete={deleteTask} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {choosingOptions && (
        <div className="location-sheet-backdrop" onMouseDown={() => setChoosingOptions(false)}>
          <section className="mobile-location-sheet animate-in" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <h2>Detalles de la tarea</h2>
            <h3>Ubicación</h3>
            <button className={!locationId ? "selected" : ""} onClick={() => setLocationId("")}>
              <House size={19} />
              <span><strong>General</strong><small>Sin una ubicación específica</small></span>
              {!locationId && <Check size={18} />}
            </button>
            {family.locations.map((location) => (
              <button key={location.id} className={locationId === location.id ? "selected" : ""} onClick={() => setLocationId(location.id)}>
                <MapPin size={19} />
                <span><strong>{location.name}</strong></span>
                {locationId === location.id && <Check size={18} />}
              </button>
            ))}
            <button className="sheet-manage-button" onClick={() => {
              setChoosingOptions(false);
              onManageLocations();
            }}>
              <Settings2 size={19} />
              <span><strong>Administrar ubicaciones</strong></span>
            </button>
            <h3>Asignar a</h3>
            <button className={!assignee ? "selected" : ""} onClick={() => setAssignee(null)}>
              <Users size={19} />
              <span><strong>Sin asignar</strong><small>Cualquiera puede hacerla</small></span>
              {!assignee && <Check size={18} />}
            </button>
            {(["Matías", "Francisca"] as Assignee[]).map((member) => (
              <button key={member} className={assignee === member ? "selected" : ""} onClick={() => setAssignee(member)}>
                <UserRound size={19} />
                <span><strong>{member}</strong></span>
                {assignee === member && <Check size={18} />}
              </button>
            ))}
            <button className="sheet-done-button" onClick={() => setChoosingOptions(false)}>Listo</button>
          </section>
        </div>
      )}
      {editingTask && (
        <EntryEditModal
          title="Editar tarea"
          value={editingTask.title}
          locationId={editingTask.locationId}
          assignee={editingTask.assignee}
          locations={family.locations}
          showAssignee
          onSave={(value, nextLocationId, nextAssignee) =>
            editTask(editingTask, value, nextLocationId, nextAssignee)
          }
          onClose={() => setEditingTask(null)}
        />
      )}
    </section>
  );
}
