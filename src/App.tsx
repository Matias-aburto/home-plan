import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  completed: boolean;
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

function initialFamilyId() {
  const fromUrl = new URLSearchParams(window.location.search).get("familia");
  return (fromUrl || localStorage.getItem("familyId") || "").toUpperCase();
}

function normalizeFamily(family: Family): Family {
  return {
    ...family,
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
  const visibleItems = useMemo(
    () => family.items.filter((item) =>
      !item.archivedAt && (filter === "all" || (filter === "none" ? !item.locationId : item.locationId === filter))
    ),
    [family.items, filter]
  );
  const pendingItems = useMemo(() => visibleItems.filter((item) => !item.completed), [visibleItems]);
  const completedItems = useMemo(() => visibleItems.filter((item) => item.completed), [visibleItems]);
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
      const item: ShoppingItem = {
        id: crypto.randomUUID(),
        name: name.trim(),
        locationId: locationId || null,
        completed: false,
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
            <button className="manage-locations-button" onClick={() => setManagingLocations(true)} aria-label="Administrar ubicaciones">
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
                {pendingItems.map((item) => (
                  <ShoppingRow key={item.id} item={item} locations={family.locations} onToggle={toggleItem} onDelete={deleteItem} />
                ))}
                {completedItems.length > 0 && (
                  <div className="completed-section">
                    <h3>Comprados · {completedItems.length}</h3>
                    {completedItems.map((item) => (
                      <ShoppingRow key={item.id} item={item} locations={family.locations} onToggle={toggleItem} onDelete={deleteItem} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        {activeSection === "tasks" && <TasksSection family={family} onMutate={onMutate} />}
        {activeSection === "calendar" && <CalendarSection family={family} onMutate={onMutate} />}
      </div>
      {managingLocations && (
        <LocationManager family={family} onClose={() => setManagingLocations(false)} />
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
    </main>
  );
}

function ShoppingRow({
  item,
  locations,
  onToggle,
  onDelete
}: {
  item: ShoppingItem;
  locations: Location[];
  onToggle: (item: ShoppingItem) => Promise<void>;
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
      <button className="delete-button" onClick={remove} aria-label={`Eliminar ${item.name}`}>
        <Trash2 size={17} />
      </button>
    </div>
  );
}

function TasksSection({
  family,
  onMutate
}: {
  family: Family;
  onMutate: (family: Family, operation: OfflineMutation) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<Assignee | null>(null);
  const [filter, setFilter] = useState<"all" | "none" | Assignee>("all");
  const [adding, setAdding] = useState(false);
  const [choosingAssignee, setChoosingAssignee] = useState(false);
  const visibleTasks = useMemo(
    () => family.tasks.filter((task) =>
      !task.archivedAt && (filter === "all" || (filter === "none" ? !task.assignee : task.assignee === filter))
    ),
    [family.tasks, filter]
  );
  const pendingTasks = useMemo(() => visibleTasks.filter((task) => !task.completed), [visibleTasks]);
  const completedTasks = useMemo(() => visibleTasks.filter((task) => task.completed), [visibleTasks]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const now = new Date().toISOString();
      const task: HouseholdTask = {
        id: crypto.randomUUID(),
        title: title.trim(),
        assignee,
        completed: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null
      };
      await onMutate({ ...family, tasks: [task, ...family.tasks] }, {
        url: `/api/families/${family.id}/tasks`,
        method: "POST",
        body: { id: task.id, title: task.title, assignee }
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

  function chooseAssignee(nextAssignee: Assignee | null) {
    setAssignee(nextAssignee);
    setChoosingAssignee(false);
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
          <button className="mobile-location-button" type="button" onClick={() => setChoosingAssignee(true)}>
            <UserRound size={15} />
            <span>{assignee || "Sin asignar"}</span>
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
            {pendingTasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} />
            ))}
            {completedTasks.length > 0 && (
              <div className="completed-section">
                <h3>Completadas · {completedTasks.length}</h3>
                {completedTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {choosingAssignee && (
        <div className="location-sheet-backdrop" onMouseDown={() => setChoosingAssignee(false)}>
          <section className="mobile-location-sheet animate-in" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <h2>Asignar a</h2>
            <button className={!assignee ? "selected" : ""} onClick={() => chooseAssignee(null)}>
              <Users size={19} />
              <span><strong>Sin asignar</strong><small>Cualquiera puede hacerla</small></span>
              {!assignee && <Check size={18} />}
            </button>
            {(["Matías", "Francisca"] as Assignee[]).map((member) => (
              <button key={member} className={assignee === member ? "selected" : ""} onClick={() => chooseAssignee(member)}>
                <UserRound size={19} />
                <span><strong>{member}</strong></span>
                {assignee === member && <Check size={18} />}
              </button>
            ))}
          </section>
        </div>
      )}
    </section>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete
}: {
  task: HouseholdTask;
  onToggle: (task: HouseholdTask) => Promise<void>;
  onDelete: (task: HouseholdTask) => Promise<void>;
}) {
  const [completing, setCompleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    <div className={`shopping-row ${task.completed ? "completed" : ""} ${completing ? "completing" : ""} ${restoring ? "restoring" : ""} ${deleting ? "deleting" : ""}`}>
      <button className="check-button" onClick={toggle} aria-label={task.completed ? "Marcar pendiente" : "Marcar completada"}>
        {(task.completed || completing) && <Check size={16} strokeWidth={3} />}
      </button>
      <button className="item-copy item-copy-button" onClick={toggle}>
        <span>{task.title}</span>
        {task.assignee && <small><em><UserRound size={11} /> {task.assignee}</em></small>}
      </button>
      <button className="delete-button" onClick={remove} aria-label={`Eliminar ${task.title}`}>
        <Trash2 size={17} />
      </button>
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
            <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>Hora <small>Opcional</small><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
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

function LocationManager({ family, onClose }: { family: Family; onClose: () => void }) {
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
            <h2>Ubicaciones</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
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
