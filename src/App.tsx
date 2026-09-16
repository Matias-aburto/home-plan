import {
  FormEvent,
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  GripVertical,
  House,
  ListTodo,
  LogIn,
  MapPin,
  Pencil,
  Plus,
  Repeat2,
  Settings2,
  Share2,
  ShoppingBasket,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import { io } from "socket.io-client";
import {
  cacheFamily,
  enqueueOperation,
  getCachedFamily,
  getPendingOperations,
  removeOperation,
  type QueuedOperation
} from "./offline";

type ShoppingItem = {
  id: string;
  name: string;
  locationId: string | null;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

type Location = {
  id: string;
  name: string;
};

type Suggestion = {
  name: string;
  category: string;
};

type Assignee = "Matías" | "Francisca";

type HouseholdTask = {
  id: string;
  title: string;
  assignee: Assignee | null;
  locationId: string | null;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

type CalendarEntry = {
  id: string;
  title: string;
  kind: "event" | "reminder";
  date: string;
  time: string | null;
  recurrence: "none" | "yearly";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type Family = {
  id: string;
  name: string;
  createdAt: string;
  locations: Location[];
  items: ShoppingItem[];
  tasks: HouseholdTask[];
  calendarEntries: CalendarEntry[];
};

type View = "welcome" | "create" | "join";
type OfflineMutation = Omit<QueuedOperation, "id" | "createdAt" | "familyId">;
type SortMode = "custom" | "alpha";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const socket = io();

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(body.message || "Algo salió mal. Inténtalo nuevamente.", response.status);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

function capitalizeFirst(input: string) {
  const text = input.trim();
  return text ? text[0].toLocaleUpperCase("es-CL") + text.slice(1) : text;
}

function initialFamilyId() {
  const fromUrl = new URLSearchParams(window.location.search).get("familia");
  return (fromUrl || localStorage.getItem("familyId") || "").toUpperCase();
}

function normalizeFamily(family: Family): Family {
  return {
    ...family,
    items: (family.items || []).map((item, index) => ({ ...item, position: item.position ?? index })),
    tasks: (family.tasks || []).map((task, index) => ({ ...task, position: task.position ?? index })),
    calendarEntries: family.calendarEntries || []
  };
}

function archiveCompletedLocally<T extends {
  completed: boolean;
  completedAt: string | null;
  updatedAt: string;
  archivedAt: string | null;
}>(entries: T[]) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const completed = entries
    .filter((entry) => entry.completed && (entry.completedAt || entry.updatedAt) >= cutoff)
    .sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
  const visibleIds = new Set(completed.slice(0, 5));
  const now = new Date().toISOString();
  return entries.map((entry) => ({
    ...entry,
    archivedAt: entry.completed
      ? visibleIds.has(entry) ? null : entry.archivedAt || now
      : null
  }));
}

function readSortMode(key: string): SortMode {
  return localStorage.getItem(key) === "alpha" ? "alpha" : "custom";
}

function useSortMode(key: string) {
  const [mode, setMode] = useState<SortMode>(() => readSortMode(key));
  useEffect(() => setMode(readSortMode(key)), [key]);
  function update(next: SortMode) {
    setMode(next);
    localStorage.setItem(key, next);
  }
  return [mode, update] as const;
}

function nextListPosition(entries: { completed: boolean; position: number }[]) {
  const positions = entries.filter((entry) => !entry.completed).map((entry) => entry.position);
  return positions.length === 0 ? 0 : Math.min(...positions) - 1;
}

function sortPending<T extends { position: number; createdAt: string }>(
  items: T[],
  mode: SortMode,
  label: (item: T) => string
) {
  const sorted = [...items];
  if (mode === "alpha") {
    return sorted.sort((a, b) =>
      label(a).localeCompare(label(b), "es", { sensitivity: "base" }) || b.createdAt.localeCompare(a.createdAt)
    );
  }
  return sorted.sort((a, b) => a.position - b.position || b.createdAt.localeCompare(a.createdAt));
}

function sortCompleted<T extends { completedAt: string | null; updatedAt: string }>(items: T[]) {
  return [...items].sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
}

function mergeVisibleOrder<T extends { id: string }>(allPending: T[], visibleIds: string[]) {
  const visible = new Set(visibleIds);
  let index = 0;
  return allPending.map((item) => {
    if (!visible.has(item.id)) return item;
    const nextId = visibleIds[index++];
    return allPending.find((candidate) => candidate.id === nextId) ?? item;
  });
}

function withPendingPositions<T extends { id: string; completed: boolean; position: number }>(
  entries: T[],
  pending: T[]
) {
  const positions = new Map(pending.map((entry, index) => [entry.id, index]));
  return entries.map((entry) =>
    positions.has(entry.id) ? { ...entry, position: positions.get(entry.id)! } : entry
  );
}

function SortChips({ value, onChange }: { value: SortMode; onChange: (mode: SortMode) => void }) {
  return (
    <div className="entry-type-picker" role="group" aria-label="Orden de la lista">
      <button type="button" className={value === "custom" ? "selected" : ""} onClick={() => onChange("custom")}>
        Personalizado
      </button>
      <button type="button" className={value === "alpha" ? "selected" : ""} onClick={() => onChange("alpha")}>
        Alfabético
      </button>
    </div>
  );
}

function useInstallApp() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      setShowGuide(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setPrompt(null);
      return;
    }
    if (isIos) setShowGuide(true);
  }

  return {
    canInstall: !installed && (Boolean(prompt) || isIos),
    install,
    showGuide,
    closeGuide: () => setShowGuide(false)
  };
}

export default function App() {
  const installApp = useInstallApp();
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState(initialFamilyId);
  const [view, setView] = useState<View>("welcome");
  const [loading, setLoading] = useState(Boolean(familyId));
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(socket.connected);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  const syncQueue = useCallback(async () => {
    if (!familyId) return;
    const operations = await getPendingOperations(familyId);
    setPendingCount(operations.length);
    if (!navigator.onLine || operations.length === 0) return;

    for (const operation of operations) {
      try {
        await api(operation.url, {
          method: operation.method,
          body: operation.body ? JSON.stringify(operation.body) : undefined
        });
        await removeOperation(operation.id);
        setPendingCount((count) => Math.max(0, count - 1));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await removeOperation(operation.id);
          setPendingCount((count) => Math.max(0, count - 1));
          continue;
        }
        return;
      }
    }

    try {
      const freshFamily = normalizeFamily(await api<Family>(`/api/families/${familyId}`));
      setFamily(freshFamily);
      await cacheFamily(freshFamily);
    } catch {
      // La cola ya quedó enviada; se actualizará en la próxima reconexión.
    }
  }, [familyId]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      void syncQueue();
    };
    const onDisconnect = () => setConnected(false);
    const onOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const onOffline = () => {
      setOnline(false);
      setConnected(false);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void syncQueue();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [syncQueue]);

  useEffect(() => {
    if (!familyId) return;
    setLoading(true);
    api<Family>(`/api/families/${familyId}`)
      .then((nextFamily) => {
        const normalizedFamily = normalizeFamily(nextFamily);
        setFamily(normalizedFamily);
        void cacheFamily(normalizedFamily);
        setError("");
        localStorage.setItem("familyId", nextFamily.id);
        const url = new URL(window.location.href);
        url.searchParams.set("familia", nextFamily.id);
        window.history.replaceState({}, "", url);
        socket.emit("family:join", nextFamily.id);
      })
      .catch(async (requestError: Error) => {
        const cachedFamily = await getCachedFamily<Family>(familyId);
        if (cachedFamily) {
          setFamily(normalizeFamily(cachedFamily));
          setError("");
          socket.emit("family:join", cachedFamily.id);
          return;
        }
        setError(navigator.onLine ? requestError.message : "Necesitas conectarte una vez antes de usar esta familia sin internet.");
        if (navigator.onLine) {
          localStorage.removeItem("familyId");
          setFamilyId("");
        }
      })
      .finally(() => setLoading(false));
  }, [familyId]);

  useEffect(() => {
    const updateFamily = async (nextFamily: Family) => {
      if (nextFamily.id !== familyId) return;
      if ((await getPendingOperations(familyId)).length > 0) return;
      const normalizedFamily = normalizeFamily(nextFamily);
      setFamily(normalizedFamily);
      await cacheFamily(normalizedFamily);
    };
    socket.on("family:updated", updateFamily);
    return () => {
      socket.off("family:updated", updateFamily);
    };
  }, [familyId]);

  function enterFamily(nextFamily: Family) {
    const normalizedFamily = normalizeFamily(nextFamily);
    setFamily(normalizedFamily);
    setFamilyId(nextFamily.id);
    void cacheFamily(normalizedFamily);
  }

  async function mutateOffline(nextFamily: Family, operation: OfflineMutation) {
    setFamily(nextFamily);
    await cacheFamily(nextFamily);
    await enqueueOperation({ ...operation, familyId: nextFamily.id });
    setPendingCount((count) => count + 1);
    await syncQueue();
  }

  function leaveFamily() {
    setFamily(null);
    setFamilyId("");
    setView("welcome");
    localStorage.removeItem("familyId");
    window.history.replaceState({}, "", window.location.pathname);
  }

  if (loading) return <Loading />;
  if (!family) {
    return (
      <>
        <Onboarding
          view={view}
          error={error}
          canInstall={installApp.canInstall}
          onInstall={installApp.install}
          onViewChange={(nextView) => {
            setError("");
            setView(nextView);
          }}
          onError={setError}
          onEnter={enterFamily}
        />
        {installApp.showGuide && <IosInstallGuide onClose={installApp.closeGuide} />}
      </>
    );
  }

  return (
    <>
      <FamilyHome
        family={family}
        connected={connected}
        online={online}
        pendingCount={pendingCount}
        canInstall={installApp.canInstall}
        onInstall={installApp.install}
        onMutate={mutateOffline}
        onLeave={leaveFamily}
      />
      {installApp.showGuide && <IosInstallGuide onClose={installApp.closeGuide} />}
    </>
  );
}

function Loading() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">
        <House size={27} strokeWidth={2.25} />
      </div>
      <span>Cargando tu casa</span>
    </main>
  );
}

function Onboarding({
  view,
  error,
  canInstall,
  onInstall,
  onViewChange,
  onError,
  onEnter
}: {
  view: View;
  error: string;
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onViewChange: (view: View) => void;
  onError: (message: string) => void;
  onEnter: (family: Family) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createFamily(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      onEnter(
        await api<Family>("/api/families", {
          method: "POST",
          body: JSON.stringify({ name })
        })
      );
    } catch (requestError) {
      onError((requestError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function joinFamily(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      onEnter(await api<Family>(`/api/families/${code.trim().toUpperCase()}`));
    } catch (requestError) {
      onError((requestError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <header className="brand">
          <div className="brand-mark">
            <House size={27} strokeWidth={2.25} />
          </div>
          <span>Casa</span>
        </header>

        {view === "welcome" ? (
          <div className="welcome-content animate-in">
            <div className="eyebrow">Tu hogar, más simple</div>
            <h1>Todo en casa,<br />en un solo lugar.</h1>
            <p>Listas compartidas para organizarse juntos.</p>
            <div className="welcome-actions">
              <button className="primary-button" onClick={() => onViewChange("create")}>
                <Users size={19} /> Crear una familia
              </button>
              <button className="secondary-button" onClick={() => onViewChange("join")}>
                <LogIn size={19} /> Unirme con un código
              </button>
            </div>
          </div>
        ) : (
          <div className="form-content animate-in">
            <button className="back-button" onClick={() => onViewChange("welcome")} aria-label="Volver">
              <ArrowLeft size={20} />
            </button>
            <div className="form-icon">{view === "create" ? <Users /> : <LogIn />}</div>
            <h1>{view === "create" ? "Crea tu familia" : "Únete a tu familia"}</h1>
            <p>{view === "create" ? "Podrás invitar a los demás después." : "Ingresa el código que compartieron contigo."}</p>
            <form onSubmit={view === "create" ? createFamily : joinFamily}>
              <label htmlFor="family-input">{view === "create" ? "Nombre de la familia" : "Código familiar"}</label>
              <input
                id="family-input"
                value={view === "create" ? name : code}
                onChange={(event) =>
                  view === "create" ? setName(event.target.value) : setCode(event.target.value.toUpperCase())
                }
                placeholder={view === "create" ? "Ej. Familia González" : "Ej. A4B8K2MX"}
                maxLength={view === "create" ? 50 : 8}
                autoFocus
                autoComplete="off"
              />
              {error && <div className="form-error">{error}</div>}
              <button className="primary-button" disabled={submitting}>
                {submitting ? "Un momento…" : view === "create" ? "Crear familia" : "Entrar"}
              </button>
            </form>
          </div>
        )}
        <footer>
          <span>Sin cuentas por ahora · Comparte solo con tu hogar</span>
          {canInstall && (
            <button className="install-link" onClick={onInstall}>
              <Download size={15} /> Instalar Casa
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}

function FamilyHome({
  family,
  connected,
  online,
  pendingCount,
  canInstall,
  onInstall,
  onMutate,
  onLeave
}: {
  family: Family;
  connected: boolean;
  online: boolean;
  pendingCount: number;
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onMutate: (family: Family, operation: OfflineMutation) => Promise<void>;
  onLeave: () => void;
}) {
  const [activeSection, setActiveSection] = useState<"shopping" | "tasks" | "calendar">("shopping");
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(() => localStorage.getItem(`location:${family.id}`) || "");
  const [filter, setFilter] = useState("all");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [shareLabel, setShareLabel] = useState("Compartir");
  const [managingLocations, setManagingLocations] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [sortMode, setSortMode] = useSortMode(`sort:shopping:${family.id}`);
  const [taskSortMode, setTaskSortMode] = useSortMode(`sort:tasks:${family.id}`);
  const visibleItems = useMemo(
    () => family.items.filter((item) =>
      !item.archivedAt && (filter === "all" || (filter === "none" ? !item.locationId : item.locationId === filter))
    ),
    [family.items, filter]
  );
  const pendingItems = useMemo(
    () => sortPending(visibleItems.filter((item) => !item.completed), sortMode, (item) => item.name),
    [visibleItems, sortMode]
  );
  const completedItems = useMemo(
    () => sortCompleted(visibleItems.filter((item) => item.completed)),
    [visibleItems]
  );
  const totalPending = useMemo(() => family.items.filter((item) => !item.completed).length, [family.items]);
  const selectedLocation = family.locations.find(({ id }) => id === locationId);

  useEffect(() => {
    if (name.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<Suggestion[]>(`/api/families/${family.id}/suggestions?q=${encodeURIComponent(name)}`, {
        signal: controller.signal
      })
        .then(setSuggestions)
        .catch((requestError) => {
          if ((requestError as Error).name !== "AbortError") setSuggestions([]);
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [family.id, name]);

  useEffect(() => setActiveSuggestion(-1), [suggestions]);

  useEffect(() => {
    if (locationId && !family.locations.some(({ id }) => id === locationId)) {
      setLocationId("");
      localStorage.removeItem(`location:${family.id}`);
    }
    if (filter !== "all" && filter !== "none" && !family.locations.some(({ id }) => id === filter)) {
      setFilter("all");
    }
  }, [family.id, family.locations, filter, locationId]);

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      const now = new Date().toISOString();
      const formattedName = capitalizeFirst(name);
      const item: ShoppingItem = {
        id: crypto.randomUUID(),
        name: formattedName,
        locationId: locationId || null,
        completed: false,
        position: nextListPosition(family.items),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null
      };
      await onMutate({ ...family, items: [item, ...family.items] }, {
        url: `/api/families/${family.id}/items`,
        method: "POST",
        body: { id: item.id, name: item.name, locationId: item.locationId }
      });
      setName("");
      setSuggestions([]);
      setSuggestionsOpen(false);
      if (locationId) localStorage.setItem(`location:${family.id}`, locationId);
    } finally {
      setAdding(false);
    }
  }

  async function toggleItem(item: ShoppingItem) {
    const completed = !item.completed;
    const now = new Date().toISOString();
    const items = archiveCompletedLocally(family.items.map((candidate) =>
      candidate.id === item.id
        ? { ...candidate, completed, updatedAt: now, completedAt: completed ? now : null, archivedAt: null }
        : candidate
    ));
    await onMutate({ ...family, items }, {
      url: `/api/families/${family.id}/items/${item.id}`,
      method: "PATCH",
      body: { completed }
    });
  }

  async function deleteItem(item: ShoppingItem) {
    await onMutate({ ...family, items: family.items.filter(({ id }) => id !== item.id) }, {
      url: `/api/families/${family.id}/items/${item.id}`,
      method: "DELETE"
    });
  }

  async function editItem(item: ShoppingItem, title: string, nextLocationId: string | null) {
    const name = capitalizeFirst(title);
    const updatedAt = new Date().toISOString();
    await onMutate({
      ...family,
      items: family.items.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, name, locationId: nextLocationId, updatedAt }
          : candidate
      )
    }, {
      url: `/api/families/${family.id}/items/${item.id}`,
      method: "PATCH",
      body: { name, locationId: nextLocationId }
    });
    setEditingItem(null);
  }

  async function reorderItems(visibleIds: string[]) {
    const allPending = sortPending(
      family.items.filter((item) => !item.completed && !item.archivedAt),
      sortMode,
      (item) => item.name
    );
    setSortMode("custom");
    const merged = mergeVisibleOrder(allPending, visibleIds);
    await onMutate({ ...family, items: withPendingPositions(family.items, merged) }, {
      url: `/api/families/${family.id}/items/reorder`,
      method: "POST",
      body: { ids: merged.map((item) => item.id) }
    });
  }

  function selectSuggestion(suggestion: Suggestion) {
    setName(suggestion.name);
    setSuggestionsOpen(false);
  }

  async function shareFamily() {
    const url = `${window.location.origin}${window.location.pathname}?familia=${family.id}`;
    const message = `Únete a ${family.name} en Casa. Código: ${family.id}`;
    if (navigator.share) {
      await navigator.share({ title: family.name, text: message, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(`${message}\n${url}`);
    setShareLabel("Copiado");
    window.setTimeout(() => setShareLabel("Compartir"), 1800);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="family-identity">
          <div className="small-brand-mark"><House size={21} /></div>
          <div>
            <span>Casa</span>
            <h1>{family.name}</h1>
          </div>
        </div>
        <div className="header-actions">
          {canInstall && (
            <button className="install-button" onClick={onInstall}>
              <Download size={17} />
              <span>Instalar</span>
            </button>
          )}
          <div className="member-avatars" aria-label="Miembros: Matías y Francisca">
            <span className="avatar-matias" title="Matías">M</span>
            <span className="avatar-francisca" title="Francisca">F</span>
          </div>
          <span className={`connection-status ${connected && online && pendingCount === 0 ? "online" : ""} ${!online || pendingCount ? "attention" : ""}`}>
            <i />
            {!online
              ? `Sin conexión${pendingCount ? ` · ${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}` : ""}`
              : pendingCount
                ? `Sincronizando · ${pendingCount}`
                : connected ? "Sincronizado" : "Reconectando"}
          </span>
          <button className="share-button" onClick={shareFamily}>
            {shareLabel === "Copiado" ? <Copy size={17} /> : <Share2 size={17} />}
            <span>{shareLabel}</span>
          </button>
        </div>
      </header>

      <div className="dashboard">
        <aside className="sidebar">
          <button
            className={`nav-item ${activeSection === "shopping" ? "active" : ""}`}
            onClick={() => setActiveSection("shopping")}
          >
            <ShoppingBasket size={20} />
            <span>Lista de compras</span>
            {totalPending > 0 && <b>{totalPending}</b>}
          </button>
          <button
            className={`nav-item ${activeSection === "tasks" ? "active" : ""}`}
            onClick={() => setActiveSection("tasks")}
          >
            <ListTodo size={20} />
            <span>Por hacer</span>
            {family.tasks.filter((task) => !task.completed).length > 0 && (
              <b>{family.tasks.filter((task) => !task.completed).length}</b>
            )}
          </button>
          <button
            className={`nav-item ${activeSection === "calendar" ? "active" : ""}`}
            onClick={() => setActiveSection("calendar")}
          >
            <CalendarDays size={20} />
            <span>Calendario</span>
          </button>
          <div className="sidebar-bottom">
            <div className="family-code">
              <span>Código familiar</span>
              <strong>{family.id}</strong>
            </div>
            <button className="leave-button" onClick={onLeave}>Salir de esta familia</button>
          </div>
        </aside>

        <section className={`content ${activeSection !== "shopping" ? "section-hidden" : ""}`}>
          <div className="content-heading">
            <div className="title-only">
              <h2>Lista de compras</h2>
            </div>
            <span>{pendingItems.length} {pendingItems.length === 1 ? "pendiente" : "pendientes"}</span>
          </div>

          <form className="add-item-form" onSubmit={addItem}>
            <div className="add-item-fields">
              <button className="mobile-location-button" type="button" onClick={() => setChoosingLocation(true)}>
                <MapPin size={15} />
                <span>{selectedLocation?.name || "General"}</span>
              </button>
              <div className="item-input-wrap">
                <Plus size={20} />
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
                  onKeyDown={(event) => {
                    if (!suggestionsOpen || suggestions.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveSuggestion((current) => Math.max(current - 1, 0));
                    } else if (event.key === "Enter" && activeSuggestion >= 0) {
                      event.preventDefault();
                      selectSuggestion(suggestions[activeSuggestion]);
                    } else if (event.key === "Escape") {
                      setSuggestionsOpen(false);
                    }
                  }}
                  placeholder="Agregar un producto"
                  aria-label="Producto"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestionsOpen && suggestions.length > 0}
                  maxLength={80}
                />
                {suggestionsOpen && suggestions.length > 0 && (
                  <div className="suggestions-menu" role="listbox">
                    {suggestions.map((suggestion, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestion}
                        className={index === activeSuggestion ? "active" : ""}
                        key={suggestion.name}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSuggestion(suggestion)}
                      >
                        <span>{suggestion.name}</span>
                        <small>{suggestion.category}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="add-button" disabled={adding || !name.trim()}>
                <Plus size={19} /><span>Agregar</span>
              </button>
            </div>
            <div className="location-picker">
              <span>Para</span>
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
            </div>
          </form>

          <div className="list-toolbar">
            <div className="filter-chips">
              <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button>
              {family.locations.map((location) => (
                <button
                  key={location.id}
                  className={filter === location.id ? "selected" : ""}
                  onClick={() => setFilter(location.id)}
                >
                  {location.name}
                </button>
              ))}
              <button className={filter === "none" ? "selected" : ""} onClick={() => setFilter("none")}>General</button>
            </div>
            <button className="manage-locations-button" onClick={() => setManagingLocations(true)} aria-label="Ajustes de la lista">
              <Settings2 size={17} />
            </button>
          </div>

          <div className="shopping-list">
            {pendingItems.length === 0 && completedItems.length === 0 ? (
              <div className="empty-state animate-in">
                <div><ShoppingBasket size={28} /></div>
                <h3>Tu lista está vacía</h3>
                <p>Agrega el primer producto para comenzar.</p>
              </div>
            ) : (
              <>
                <SortableList
                  items={pendingItems}
                  onReorder={reorderItems}
                  renderItem={(item, dragHandle) => (
                    <ShoppingRow
                      item={item}
                      locations={family.locations}
                      dragHandle={dragHandle}
                      onToggle={toggleItem}
                      onEdit={setEditingItem}
                      onDelete={deleteItem}
                    />
                  )}
                />
                {completedItems.length > 0 && (
                  <div className="completed-section">
                    <h3>Comprados · {completedItems.length}</h3>
                    {completedItems.map((item) => (
                      <ShoppingRow key={item.id} item={item} locations={family.locations} onToggle={toggleItem} onEdit={setEditingItem} onDelete={deleteItem} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        {activeSection === "tasks" && (
          <TasksSection
            family={family}
            sortMode={taskSortMode}
            onSortChange={setTaskSortMode}
            onMutate={onMutate}
            onManageLocations={() => setManagingLocations(true)}
          />
        )}
        {activeSection === "calendar" && <CalendarSection family={family} onMutate={onMutate} />}
      </div>
      {managingLocations && (
        <LocationManager
          family={family}
          sortMode={activeSection === "tasks" ? taskSortMode : sortMode}
          onSortChange={activeSection === "tasks" ? setTaskSortMode : setSortMode}
          onClose={() => setManagingLocations(false)}
        />
      )}
      {choosingLocation && (
        <div className="location-sheet-backdrop" onMouseDown={() => setChoosingLocation(false)}>
          <section className="mobile-location-sheet animate-in" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <h2>¿Para dónde?</h2>
            <button
              className={!locationId ? "selected" : ""}
              onClick={() => {
                setLocationId("");
                setChoosingLocation(false);
              }}
            >
              <House size={19} />
              <span><strong>General</strong><small>Sirve para cualquier ubicación</small></span>
              {!locationId && <Check size={18} />}
            </button>
            {family.locations.map((location) => (
              <button
                key={location.id}
                className={locationId === location.id ? "selected" : ""}
                onClick={() => {
                  setLocationId(location.id);
                  localStorage.setItem(`location:${family.id}`, location.id);
                  setChoosingLocation(false);
                }}
              >
                <MapPin size={19} />
                <span><strong>{location.name}</strong></span>
                {locationId === location.id && <Check size={18} />}
              </button>
            ))}
          </section>
        </div>
      )}
      {editingItem && (
        <EntryEditModal
          title="Editar producto"
          value={editingItem.name}
          locationId={editingItem.locationId}
          locations={family.locations}
          onSave={(value, nextLocationId) => editItem(editingItem, value, nextLocationId)}
          onClose={() => setEditingItem(null)}
        />
      )}
    </main>
  );
}

const ReorderLockContext = createContext(false);

function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const draggingIdRef = useRef<string | null>(null);
  const orderRef = useRef(order);
  const itemsRef = useRef(items);
  const origin = useRef<{ id: string; x: number; y: number; pointerId: number; node: HTMLElement } | null>(null);
  const longPress = useRef<number | null>(null);
  const didMove = useRef(false);
  const suppressClick = useRef(false);
  const scrollBlocker = useRef<((event: TouchEvent) => void) | null>(null);
  const windowMove = useRef<((event: PointerEvent) => void) | null>(null);
  const windowUp = useRef<((event: PointerEvent) => void) | null>(null);
  const itemIds = items.map((item) => item.id).join(",");

  itemsRef.current = items;
  orderRef.current = order;

  useEffect(() => {
    if (!draggingId) setOrder(items.map((item) => item.id));
  }, [draggingId, itemIds, items]);

  useEffect(() => () => {
    clearTimer();
    unlockScroll();
    detachWindow();
  }, []);

  function clearTimer() {
    if (longPress.current) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  }

  function lockScroll() {
    if (scrollBlocker.current) return;
    const blocker = (event: TouchEvent) => event.preventDefault();
    scrollBlocker.current = blocker;
    document.addEventListener("touchmove", blocker, { passive: false, capture: true });
    document.documentElement.classList.add("reordering");
    document.body.classList.add("reordering");
  }

  function unlockScroll() {
    if (!scrollBlocker.current) return;
    document.removeEventListener("touchmove", scrollBlocker.current, true);
    scrollBlocker.current = null;
    document.documentElement.classList.remove("reordering");
    document.body.classList.remove("reordering");
  }

  function detachWindow() {
    if (windowMove.current) window.removeEventListener("pointermove", windowMove.current);
    if (windowUp.current) {
      window.removeEventListener("pointerup", windowUp.current);
      window.removeEventListener("pointercancel", windowUp.current);
    }
    windowMove.current = null;
    windowUp.current = null;
  }

  function attachWindow(pointerId: number) {
    detachWindow();
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      handleMove(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      finishDrag();
    };
    windowMove.current = onMove;
    windowUp.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function beginDrag(id: string, pointerId: number, target: HTMLElement | null) {
    clearTimer();
    draggingIdRef.current = id;
    setDraggingId(id);
    lockScroll();
    const item = target?.closest(".sortable-item") as HTMLElement | null;
    try {
      item?.setPointerCapture(pointerId);
    } catch {
      // El pointer puede no admitir captura en este elemento.
    }
    attachWindow(pointerId);
    navigator.vibrate?.(12);
  }

  function startHold(event: ReactPointerEvent<HTMLElement>, id: string, fromHandle: boolean) {
    if (itemsRef.current.length < 2) return;
    origin.current = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, node: event.currentTarget };
    didMove.current = false;
    if (fromHandle && event.pointerType !== "touch") {
      beginDrag(id, event.pointerId, event.currentTarget);
      return;
    }
    if (event.pointerType !== "touch") return;
    longPress.current = window.setTimeout(() => {
      if (!origin.current) return;
      beginDrag(origin.current.id, origin.current.pointerId, origin.current.node);
    }, 420);
  }

  function handleMove(clientX: number, clientY: number) {
    if (!origin.current) return;
    const deltaX = clientX - origin.current.x;
    const deltaY = clientY - origin.current.y;
    if (!draggingIdRef.current) {
      if (Math.hypot(deltaX, deltaY) > 8) clearTimer();
      return;
    }
    const over = document.elementFromPoint(clientX, clientY)?.closest("[data-sortable-id]") as HTMLElement | null;
    const overId = over?.dataset.sortableId;
    if (!overId || overId === draggingIdRef.current) return;
    const from = orderRef.current.indexOf(draggingIdRef.current);
    const to = orderRef.current.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const rect = over.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    if (from < to && clientY < middle) return;
    if (from > to && clientY > middle) return;
    didMove.current = true;
    const next = [...orderRef.current];
    next.splice(from, 1);
    next.splice(to, 0, draggingIdRef.current);
    orderRef.current = next;
    setOrder(next);
  }

  function finishDrag() {
    clearTimer();
    detachWindow();
    unlockScroll();
    const dragged = draggingIdRef.current;
    const nextOrder = orderRef.current;
    const previous = itemsRef.current.map((item) => item.id);
    const moved = didMove.current;
    origin.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    didMove.current = false;
    if (!dragged || !moved || nextOrder.join() === previous.join()) return;
    suppressClick.current = true;
    onReorder(nextOrder);
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!origin.current) return;
    if (draggingIdRef.current) event.preventDefault();
    handleMove(event.clientX, event.clientY);
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const orderedItems = order.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));

  return (
    <ReorderLockContext.Provider value={Boolean(draggingId)}>
      <div className={`sortable-list ${draggingId ? "is-reordering" : ""}`}>
        {orderedItems.map((item) => (
          <div
            key={item.id}
            data-sortable-id={item.id}
            className={`sortable-item ${draggingId === item.id ? "is-dragging" : ""}`}
            onPointerDown={(event) => startHold(event, item.id, false)}
            onPointerMove={pointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onContextMenu={(event) => {
              if (draggingIdRef.current) event.preventDefault();
            }}
            onClickCapture={(event) => {
              if (!suppressClick.current) return;
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }}
          >
            {renderItem(item, (
              <button
                type="button"
                className="drag-handle"
                aria-label="Reordenar"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  startHold(event, item.id, true);
                }}
              >
                <GripVertical size={16} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </ReorderLockContext.Provider>
  );
}

function SwipeCard({
  label,
  children,
  onEdit,
  onDelete
}: {
  label: string;
  children: ReactNode;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const reordering = useContext(ReorderLockContext);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; offset: number; armed: boolean } | null>(null);
  const actionWidth = 140;

  useEffect(() => {
    if (!reordering) return;
    start.current = null;
    setOffset(0);
    setDragging(false);
  }, [reordering]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || reordering) return;
    start.current = { x: event.clientX, y: event.clientY, offset, armed: false };
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current || event.pointerType !== "touch" || reordering) return;
    const deltaX = event.clientX - start.current.x;
    const deltaY = event.clientY - start.current.y;
    if (!start.current.armed) {
      if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        start.current = null;
        return;
      }
      start.current.armed = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setOffset(Math.max(-actionWidth, Math.min(0, start.current.offset + deltaX)));
  }

  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    if (start.current.armed) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // El pointer ya no está capturado.
      }
    }
    const finalOffset = start.current.armed
      ? Math.max(-actionWidth, Math.min(0, start.current.offset + event.clientX - start.current.x))
      : start.current.offset;
    setOffset(finalOffset < -44 ? -actionWidth : 0);
    setDragging(false);
    start.current = null;
  }

  function pointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    if (start.current.armed) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // El pointer ya no está capturado.
      }
    }
    setOffset(start.current.offset);
    setDragging(false);
    start.current = null;
  }

  return (
    <div className={`swipe-card ${offset < 0 ? "open" : ""} ${dragging ? "dragging" : ""}`}>
      <div className="swipe-actions" aria-hidden={offset === 0}>
        <button className="swipe-edit" onClick={() => {
          setOffset(0);
          onEdit();
        }} aria-label={`Editar ${label}`} tabIndex={offset < 0 ? 0 : -1}>
          <Pencil size={18} /><span>Editar</span>
        </button>
        <button className="swipe-delete" onClick={onDelete} aria-label={`Eliminar ${label}`} tabIndex={offset < 0 ? 0 : -1}>
          <Trash2 size={18} /><span>Eliminar</span>
        </button>
      </div>
      <div
        className={`swipe-card-content ${dragging ? "dragging" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerCancel}
      >
        {children}
      </div>
    </div>
  );
}

function ShoppingRow({
  item,
  locations,
  dragHandle,
  onToggle,
  onEdit,
  onDelete
}: {
  item: ShoppingItem;
  locations: Location[];
  dragHandle?: ReactNode;
  onToggle: (item: ShoppingItem) => Promise<void>;
  onEdit: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => Promise<void>;
}) {
  const [completing, setCompleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const location = locations.find(({ id }) => id === item.locationId);

  async function toggle() {
    if (completing || restoring || deleting) return;
    if (item.completed) {
      setRestoring(true);
      await new Promise((resolve) => window.setTimeout(resolve, 460));
      await onToggle(item);
      setRestoring(false);
      return;
    }
    setCompleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    await onToggle(item);
    setCompleting(false);
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 360));
    await onDelete(item);
  }

  return (
    <SwipeCard label={item.name} onEdit={() => onEdit(item)} onDelete={remove}>
      <div className={`shopping-row ${item.completed ? "completed" : ""} ${completing ? "completing" : ""} ${restoring ? "restoring" : ""} ${deleting ? "deleting" : ""}`}>
        <button className="check-button" onClick={toggle} aria-label={item.completed ? "Marcar pendiente" : "Marcar comprado"}>
          {(item.completed || completing) && <Check size={16} strokeWidth={3} />}
        </button>
        <button className="item-copy item-copy-button" onClick={toggle}>
          <span>{item.name}</span>
          {location && (
            <small>
              <em><MapPin size={11} /> {location.name}</em>
            </small>
          )}
        </button>
        {dragHandle}
        <button className="edit-button direct-row-action" onClick={() => onEdit(item)} aria-label={`Editar ${item.name}`}>
          <Pencil size={16} />
        </button>
        <button className="delete-button direct-row-action" onClick={remove} aria-label={`Eliminar ${item.name}`}>
          <Trash2 size={17} />
        </button>
      </div>
    </SwipeCard>
  );
}

function TasksSection({
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

function TaskRow({
  task,
  locations,
  dragHandle,
  onToggle,
  onEdit,
  onDelete
}: {
  task: HouseholdTask;
  locations: Location[];
  dragHandle?: ReactNode;
  onToggle: (task: HouseholdTask) => Promise<void>;
  onEdit: (task: HouseholdTask) => void;
  onDelete: (task: HouseholdTask) => Promise<void>;
}) {
  const [completing, setCompleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const location = locations.find(({ id }) => id === task.locationId);

  async function toggle() {
    if (completing || restoring || deleting) return;
    if (task.completed) {
      setRestoring(true);
      await new Promise((resolve) => window.setTimeout(resolve, 460));
      await onToggle(task);
      setRestoring(false);
      return;
    }
    setCompleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    await onToggle(task);
    setCompleting(false);
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 360));
    await onDelete(task);
  }

  return (
    <SwipeCard label={task.title} onEdit={() => onEdit(task)} onDelete={remove}>
      <div className={`shopping-row ${task.completed ? "completed" : ""} ${completing ? "completing" : ""} ${restoring ? "restoring" : ""} ${deleting ? "deleting" : ""}`}>
        <button className="check-button" onClick={toggle} aria-label={task.completed ? "Marcar pendiente" : "Marcar completada"}>
          {(task.completed || completing) && <Check size={16} strokeWidth={3} />}
        </button>
        <button className="item-copy item-copy-button" onClick={toggle}>
          <span>{task.title}</span>
          {(task.assignee || location) && (
            <small>
              {task.assignee && <em><UserRound size={11} /> {task.assignee}</em>}
              {location && <em><MapPin size={11} /> {location.name}</em>}
            </small>
          )}
        </button>
        {dragHandle}
        <button className="edit-button direct-row-action" onClick={() => onEdit(task)} aria-label={`Editar ${task.title}`}>
          <Pencil size={16} />
        </button>
        <button className="delete-button direct-row-action" onClick={remove} aria-label={`Eliminar ${task.title}`}>
          <Trash2 size={17} />
        </button>
      </div>
    </SwipeCard>
  );
}

function EntryEditModal({
  title,
  value,
  locationId,
  assignee = null,
  locations,
  showAssignee = false,
  onSave,
  onClose
}: {
  title: string;
  value: string;
  locationId: string | null;
  assignee?: Assignee | null;
  locations: Location[];
  showAssignee?: boolean;
  onSave: (value: string, locationId: string | null, assignee: Assignee | null) => Promise<void>;
  onClose: () => void;
}) {
  const [nextValue, setNextValue] = useState(value);
  const [nextLocationId, setNextLocationId] = useState(locationId || "");
  const [nextAssignee, setNextAssignee] = useState<Assignee | null>(assignee);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!nextValue.trim()) return;
    setSaving(true);
    try {
      await onSave(nextValue, nextLocationId || null, nextAssignee);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop entry-edit-backdrop" onMouseDown={onClose}>
      <section className="entry-edit-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <label>Nombre
            <input
              value={nextValue}
              onChange={(event) => setNextValue(event.target.value)}
              maxLength={100}
              autoFocus={!window.matchMedia("(max-width: 720px)").matches}
            />
          </label>
          <fieldset>
            <legend>Ubicación</legend>
            <div className="edit-option-chips">
              <button type="button" className={!nextLocationId ? "selected" : ""} onClick={() => setNextLocationId("")}>
                <House size={14} /> General
              </button>
              {locations.map((location) => (
                <button
                  type="button"
                  key={location.id}
                  className={nextLocationId === location.id ? "selected" : ""}
                  onClick={() => setNextLocationId(location.id)}
                >
                  <MapPin size={14} /> {location.name}
                </button>
              ))}
            </div>
          </fieldset>
          {showAssignee && (
            <fieldset>
              <legend>Asignar a</legend>
              <div className="edit-option-chips">
                <button type="button" className={!nextAssignee ? "selected" : ""} onClick={() => setNextAssignee(null)}>
                  Sin asignar
                </button>
                {(["Matías", "Francisca"] as Assignee[]).map((member) => (
                  <button
                    type="button"
                    key={member}
                    className={nextAssignee === member ? "selected" : ""}
                    onClick={() => setNextAssignee(member)}
                  >
                    <UserRound size={14} /> {member}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button className="primary-button" disabled={saving || !nextValue.trim()}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </form>
      </section>
    </div>
  );
}

const monthFormatter = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" });
const dayFormatter = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long" });
const compactDateFormatter = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function occurrenceKey(entry: CalendarEntry, year: number) {
  if (entry.recurrence === "none") return entry.date;
  const [, month, day] = entry.date.split("-");
  const key = `${year}-${month}-${day}`;
  return dateKey(localDate(key)) === key ? key : null;
}

function entriesOnDate(entries: CalendarEntry[], key: string) {
  const year = Number(key.slice(0, 4));
  return entries
    .filter((entry) => occurrenceKey(entry, year) === key)
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

function CalendarSection({
  family,
  onMutate
}: {
  family: Family;
  onMutate: (family: Family, operation: OfflineMutation) => Promise<void>;
}) {
  const today = dateKey(new Date());
  const entries = family.calendarEntries || [];
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [editing, setEditing] = useState<CalendarEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);

  const selectedEntries = useMemo(
    () => entriesOnDate(entries, selectedDate),
    [entries, selectedDate]
  );

  const upcoming = useMemo(() => {
    const start = localDate(today);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    return entries.flatMap((entry) => {
      if (entry.recurrence === "none") {
        return entry.date >= today && localDate(entry.date) <= end
          ? [{ entry, key: entry.date }]
          : [];
      }
      let key = occurrenceKey(entry, start.getFullYear());
      if (!key || key < today) key = occurrenceKey(entry, start.getFullYear() + 1);
      return key && localDate(key) <= end ? [{ entry, key }] : [];
    }).sort((a, b) =>
      a.key.localeCompare(b.key) || (a.entry.time || "99:99").localeCompare(b.entry.time || "99:99")
    ).slice(0, 6);
  }, [entries, today]);

  function changeMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(dateKey(next));
  }

  function selectDay(day: Date) {
    setSelectedDate(dateKey(day));
    if (day.getMonth() !== month.getMonth()) {
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }

  async function saveEntry(data: Omit<CalendarEntry, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    if (editing) {
      const updated = { ...editing, ...data, updatedAt: now };
      await onMutate({
        ...family,
        calendarEntries: entries.map((entry) => entry.id === editing.id ? updated : entry)
      }, {
        url: `/api/families/${family.id}/calendar/${editing.id}`,
        method: "PATCH",
        body: data
      });
    } else {
      const entry: CalendarEntry = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: now,
        updatedAt: now
      };
      await onMutate({ ...family, calendarEntries: [...entries, entry] }, {
        url: `/api/families/${family.id}/calendar`,
        method: "POST",
        body: { id: entry.id, ...data }
      });
    }
    setCreating(false);
    setEditing(null);
  }

  async function deleteEntry(entry: CalendarEntry) {
    await onMutate({
      ...family,
      calendarEntries: entries.filter(({ id }) => id !== entry.id)
    }, {
      url: `/api/families/${family.id}/calendar/${entry.id}`,
      method: "DELETE"
    });
    setEditing(null);
  }

  return (
    <section className="content calendar-content">
      <div className="content-heading calendar-heading">
        <div className="title-only"><h2>Calendario</h2></div>
        <button className="calendar-add-button" onClick={() => setCreating(true)}>
          <Plus size={18} /> Nuevo
        </button>
      </div>

      <div className="calendar-layout">
        <div className="calendar-card">
          <header className="calendar-month-header">
            <button onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={20} /></button>
            <h3>{monthFormatter.format(month)}</h3>
            <button onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight size={20} /></button>
          </header>
          <div className="calendar-weekdays" aria-hidden="true">
            {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const key = dateKey(day);
              const dayEntries = entriesOnDate(entries, key);
              return (
                <button
                  key={key}
                  className={`calendar-day ${day.getMonth() !== month.getMonth() ? "outside" : ""} ${key === today ? "today" : ""} ${key === selectedDate ? "selected" : ""}`}
                  onClick={() => selectDay(day)}
                  aria-label={dayFormatter.format(day)}
                >
                  <span>{day.getDate()}</span>
                  <i className="calendar-dots">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <b key={entry.id} className={entry.kind} />
                    ))}
                  </i>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="calendar-agenda">
          <div className="agenda-heading">
            <span>{selectedDate === today ? "Hoy" : dayFormatter.format(localDate(selectedDate))}</span>
            <button onClick={() => setCreating(true)} aria-label="Agregar en este día"><Plus size={17} /></button>
          </div>
          <div className="agenda-list">
            {selectedEntries.length ? selectedEntries.map((entry) => (
              <CalendarEntryRow key={entry.id} entry={entry} onEdit={setEditing} />
            )) : (
              <div className="agenda-empty">Nada agendado para este día.</div>
            )}
          </div>

          <h4>Próximos</h4>
          <div className="upcoming-list">
            {upcoming.length ? upcoming.map(({ entry, key }) => (
              <button key={`${entry.id}-${key}`} onClick={() => {
                setSelectedDate(key);
                const date = localDate(key);
                setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
              }}>
                <time>{compactDateFormatter.format(localDate(key))}</time>
                <span>{entry.title}</span>
                {entry.time && <small>{entry.time}</small>}
              </button>
            )) : <span className="agenda-empty">No hay eventos próximos.</span>}
          </div>
        </aside>
      </div>

      {(creating || editing) && (
        <CalendarEntryModal
          entry={editing}
          defaultDate={selectedDate}
          onSave={saveEntry}
          onDelete={editing ? () => deleteEntry(editing) : undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function CalendarEntryRow({
  entry,
  onEdit
}: {
  entry: CalendarEntry;
  onEdit: (entry: CalendarEntry) => void;
}) {
  return (
    <button className={`calendar-entry-row ${entry.kind}`} onClick={() => onEdit(entry)}>
      <span className="entry-kind-icon">{entry.kind === "reminder" ? <Bell size={16} /> : <CalendarDays size={16} />}</span>
      <span className="entry-copy">
        <strong>{entry.title}</strong>
        <small>
          {entry.time ? <><Clock3 size={12} /> {entry.time}</> : "Todo el día"}
          {entry.recurrence === "yearly" && <><Repeat2 size={12} /> Anual</>}
        </small>
      </span>
      <Pencil size={15} />
    </button>
  );
}

function CalendarEntryModal({
  entry,
  defaultDate,
  onSave,
  onDelete,
  onClose
}: {
  entry: CalendarEntry | null;
  defaultDate: string;
  onSave: (entry: Omit<CalendarEntry, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(entry?.title || "");
  const [kind, setKind] = useState<CalendarEntry["kind"]>(entry?.kind || "event");
  const [date, setDate] = useState(entry?.date || defaultDate);
  const [time, setTime] = useState(entry?.time || "");
  const [recurrence, setRecurrence] = useState<CalendarEntry["recurrence"]>(entry?.recurrence || "none");
  const [notes, setNotes] = useState(entry?.notes || "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        kind,
        date,
        time: time || null,
        recurrence,
        notes: notes.trim() || null
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop calendar-modal-backdrop" onMouseDown={onClose}>
      <section className="calendar-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">{entry ? "Editar" : "Nuevo"}</div>
            <h2>{kind === "event" ? "Evento" : "Recordatorio"}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="entry-type-picker">
            <button type="button" className={kind === "event" ? "selected" : ""} onClick={() => setKind("event")}>
              <CalendarDays size={16} /> Evento
            </button>
            <button type="button" className={kind === "reminder" ? "selected" : ""} onClick={() => setKind("reminder")}>
              <Bell size={16} /> Recordatorio
            </button>
          </div>
          <label>Título
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={100}
              autoFocus={!window.matchMedia("(max-width: 720px)").matches}
              placeholder="Ej. Cumpleaños de mamá"
            />
          </label>
          <div className="calendar-form-row">
            <label>
              <span className="calendar-field-label">Fecha</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>
              <span className="calendar-field-label">Hora <small>Opcional</small></span>
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
          </div>
          <label>Repetición
            <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as CalendarEntry["recurrence"])}>
              <option value="none">No repetir</option>
              <option value="yearly">Cada año</option>
            </select>
          </label>
          <label>Notas <small>Opcional</small>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} rows={3} placeholder="Detalles útiles para la familia" />
          </label>
          <div className="calendar-modal-actions">
            {onDelete && (
              <button type="button" className="calendar-delete-button" onClick={onDelete}>
                <Trash2 size={17} /> Eliminar
              </button>
            )}
            <button className="primary-button" disabled={saving || !title.trim() || !date}>
              {saving ? "Guardando…" : entry ? "Guardar cambios" : "Agregar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function IosInstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop install-guide-backdrop" onMouseDown={onClose}>
      <section className="install-guide animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="install-guide-icon"><Download size={23} /></div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <h2>Instala Casa</h2>
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
            <span><House size={18} /></span>
            <div><strong>Confirma con “Agregar”</strong><small>Casa aparecerá junto a tus apps.</small></div>
          </li>
        </ol>
        <button className="primary-button" onClick={onClose}>Entendido</button>
      </section>
    </div>
  );
}

function LocationManager({
  family,
  sortMode,
  onSortChange,
  onClose
}: {
  family: Family;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onClose: () => void;
}) {
  const [newLocation, setNewLocation] = useState("");
  const [error, setError] = useState("");

  async function addLocation(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/families/${family.id}/locations`, {
        method: "POST",
        body: JSON.stringify({ name: newLocation })
      });
      setNewLocation("");
      setError("");
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }

  async function renameLocation(location: Location, name: string) {
    if (!name.trim() || name.trim() === location.name) return;
    try {
      await api(`/api/families/${family.id}/locations/${location.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      setError("");
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }

  async function deleteLocation(location: Location) {
    await api(`/api/families/${family.id}/locations/${location.id}`, { method: "DELETE" });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Tu hogar</div>
            <h2>Ajustes</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <div className="list-settings-sort">
          <h3>Orden</h3>
          <SortChips value={sortMode} onChange={onSortChange} />
          <p>Arrastrá los ítems para armar el orden personalizado.</p>
        </div>
        <h3 className="list-settings-heading">Ubicaciones</h3>
        <p>Usa las que necesites. Si eliminas una, sus productos quedarán como generales.</p>
        <div className="locations-list">
          {family.locations.map((location) => (
            <div className="location-edit-row" key={location.id}>
              <MapPin size={17} />
              <input
                defaultValue={location.name}
                maxLength={30}
                aria-label={`Nombre de ${location.name}`}
                onBlur={(event) => renameLocation(location, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <button onClick={() => deleteLocation(location)} aria-label={`Eliminar ${location.name}`}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <form className="new-location-form" onSubmit={addLocation}>
          <input
            value={newLocation}
            onChange={(event) => setNewLocation(event.target.value)}
            placeholder="Nueva ubicación"
            maxLength={30}
          />
          <button disabled={!newLocation.trim()}><Plus size={18} /> Agregar</button>
        </form>
        {error && <div className="form-error">{error}</div>}
      </section>
    </div>
  );
}
