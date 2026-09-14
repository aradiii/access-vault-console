// Central client-side state for the Remote Desktop Operations Console.
// All server communication goes through the REST API (no direct DB access).
//
// The fleet IS the Access Vault: every dashboard server is a credential entry
// probed over real TCP. Demo/simulated mode was removed entirely.

import { create } from "zustand";
import { toast } from "sonner";
import {
  AGENT_FRESH_MS,
  DEFAULT_SETTINGS,
  type ActivityDTO,
  type ConsoleSettings,
  type CredentialDTO,
  type EndpointStatus,
  type NewCredentialInput,
  type ProbeRecordDTO,
  type VaultFilters,
} from "@/lib/console-types";
import { applyTheme } from "@/lib/theme-bridge";

export type TabKey = "dashboard" | "vault" | "activity" | "settings";

export interface ConsoleFilters {
  search: string;
  status: "all" | EndpointStatus;
  domain: string; // "all" or domain name
  sort: "name_asc" | "name_desc" | "latency_asc" | "latency_desc" | "status_asc";
}

interface ConsoleState {
  booted: boolean;
  activeTab: TabKey;
  settings: ConsoleSettings;
  credentials: CredentialDTO[];
  activities: ActivityDTO[];
  historyCache: Record<string, ProbeRecordDTO[]>;
  selectedId: string | null;
  filters: ConsoleFilters;
  probing: boolean;
  checkingIds: Record<string, boolean>;
  countdownSec: number;
  backendMessage: string;
  mobileNavOpen: boolean;

  // access vault
  vaultFilters: VaultFilters;
  credDialogOpen: boolean;
  editingCredentialId: string | null;
  importDialogOpen: boolean;
  credBusyIds: Record<string, boolean>;

  // live RDP sessions
  sessionDialogOpen: boolean;
  sessionCredentialId: string | null;
  setSessionDialogOpen: (open: boolean, credentialId?: string | null) => void;

  // monitor agent setup
  agentDialogOpen: boolean;
  agentCredentialId: string | null;
  setAgentDialogOpen: (open: boolean, credentialId?: string | null) => void;

  // lifecycle
  bootstrap: () => Promise<void>;
  tick: () => void;
  resetCountdown: () => void;

  // navigation / ui
  setActiveTab: (tab: TabKey) => void;
  setMobileNavOpen: (open: boolean) => void;
  selectServer: (id: string | null) => void;
  setFilter: (patch: Partial<ConsoleFilters>) => void;

  // fleet data
  fetchCredentials: (silent?: boolean) => Promise<void>;
  fetchActivities: () => Promise<void>;
  probeFleet: () => Promise<void>;
  probeSingle: (id: string) => Promise<void>;
  loadHistory: (id: string, notify?: boolean) => Promise<void>;
  saveSettings: (patch: Partial<ConsoleSettings>) => Promise<boolean>;
  clearActivities: () => Promise<void>;
  clearProbeData: () => Promise<void>;
  clearAllData: () => Promise<void>;

  // vault mutations (shared by vault view + dashboard)
  setVaultFilter: (patch: Partial<VaultFilters>) => void;
  setCredDialogOpen: (open: boolean, editId?: string | null) => void;
  setImportDialogOpen: (open: boolean) => void;
  addCredential: (input: NewCredentialInput) => Promise<boolean>;
  updateCredential: (id: string, input: NewCredentialInput) => Promise<boolean>;
  deleteCredential: (id: string) => Promise<void>;
  importCredentials: (text: string, mode: "append" | "replace") => Promise<boolean>;
  applyCredentials: (credentials: CredentialDTO[]) => void;
  refreshAfterMutation: () => Promise<void>;
}

// --- helpers ---------------------------------------------------------------

async function fetchJson(url: string, options: RequestInit = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    clearTimeout(timer);
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errBody = await response.json();
        if (errBody?.message) detail = errBody.message;
      } catch {
        /* ignore parse failure */
      }
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    return await response.json();
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Network timeout of ${timeoutMs}ms exceeded for: ${url}`);
    }
    throw err;
  }
}

function notify(message: string, settings: ConsoleSettings) {
  if (
    settings.desktopNotifications &&
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      new Notification("Remote Desktop Ops", { body: message });
    } catch {
      /* notification failures are non-fatal */
    }
  }
}

// --- store ------------------------------------------------------------------

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  booted: false,
  activeTab: "dashboard",
  settings: { ...DEFAULT_SETTINGS },
  credentials: [],
  activities: [],
  historyCache: {},
  selectedId: null,
  filters: { search: "", status: "all", domain: "all", sort: "name_asc" },
  probing: false,
  checkingIds: {},
  countdownSec: 30,
  backendMessage: "Backend: Connected (same-origin API)",
  mobileNavOpen: false,

  vaultFilters: { search: "", domain: "all", sort: "domain_asc", revealAll: false },
  credDialogOpen: false,
  editingCredentialId: null,
  importDialogOpen: false,
  credBusyIds: {},
  sessionDialogOpen: false,
  sessionCredentialId: null,
  agentDialogOpen: false,
  agentCredentialId: null,

  bootstrap: async () => {
    try {
      const [{ settings }, acts, vault] = await Promise.all([
        fetchJson("/api/settings") as Promise<{ settings: ConsoleSettings }>,
        fetchJson("/api/activities") as Promise<{ activities: ActivityDTO[] }>,
        fetchJson("/api/rdp/credentials") as Promise<{ credentials: CredentialDTO[] }>,
      ]);
      applyTheme(settings.theme);
      set({
        booted: true,
        settings,
        credentials: vault.credentials,
        activities: acts.activities,
        countdownSec: settings.probeIntervalSec,
      });
    } catch (err) {
      set({
        booted: true,
        backendMessage: "Backend Error: " + (err instanceof Error ? err.message : "unknown"),
      });
      toast.error("Failed to initialize console: " + (err instanceof Error ? err.message : "unknown"));
    }
  },

  tick: () => {
    const { probing, countdownSec, probeFleet } = get();
    if (probing) return;
    if (countdownSec <= 1) {
      set({ countdownSec: get().settings.probeIntervalSec });
      void probeFleet();
    } else {
      set({ countdownSec: countdownSec - 1 });
    }
  },

  resetCountdown: () => set({ countdownSec: get().settings.probeIntervalSec }),

  setActiveTab: (tab) => set({ activeTab: tab, mobileNavOpen: false }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),

  selectServer: (id) => set({ selectedId: id }),

  setFilter: (patch) => set({ filters: { ...get().filters, ...patch } }),

  setVaultFilter: (patch) => set({ vaultFilters: { ...get().vaultFilters, ...patch } }),
  setCredDialogOpen: (open, editId = null) =>
    set({ credDialogOpen: open, editingCredentialId: open ? editId ?? null : null }),
  setImportDialogOpen: (open) => set({ importDialogOpen: open }),
  setSessionDialogOpen: (open, credentialId = null) =>
    set({ sessionDialogOpen: open, sessionCredentialId: open ? credentialId ?? null : null }),
  setAgentDialogOpen: (open, credentialId = null) =>
    set({ agentDialogOpen: open, agentCredentialId: open ? credentialId ?? null : null }),

  fetchCredentials: async (silent = false) => {
    try {
      const vault = (await fetchJson("/api/rdp/credentials")) as {
        credentials: CredentialDTO[];
      };
      set({ credentials: vault.credentials });
      if (!silent) toast.info("Credential vault refreshed.");
    } catch (err) {
      if (!silent)
        toast.error("Vault refresh failed: " + (err instanceof Error ? err.message : "unknown"));
    }
  },

  fetchActivities: async () => {
    try {
      const acts = (await fetchJson("/api/activities")) as { activities: ActivityDTO[] };
      set({ activities: acts.activities });
    } catch {
      /* non-fatal */
    }
  },

  probeFleet: async () => {
    const state = get();
    if (state.probing) {
      toast.warning("Probe already in progress. Please wait.");
      return;
    }
    set({ probing: true });
    try {
      const result = (await fetchJson("/api/rdp/monitor", {
        method: "POST",
        body: JSON.stringify({}),
      })) as {
        credentials: CredentialDTO[];
        counts: { online: number; degraded: number; offline: number };
      };
      set({ credentials: result.credentials, backendMessage: "Backend: Connected (same-origin API)" });
      toast.success(
        `Fleet probe completed — ${result.counts.online} online, ${result.counts.degraded} degraded, ${result.counts.offline} offline.`
      );
      notify("Fleet probe completed.", state.settings);
      const selectedId = get().selectedId;
      if (selectedId) void get().loadHistory(selectedId, false);
    } catch (err) {
      const msg = "Fleet probe failed: " + (err instanceof Error ? err.message : "unknown");
      toast.error(msg);
      set({ backendMessage: "Backend Error: " + (err instanceof Error ? err.message : "unknown") });
    } finally {
      set({ probing: false });
      get().resetCountdown();
      void get().fetchActivities();
    }
  },

  probeSingle: async (id) => {
    const cred = get().credentials.find((c) => c.id === id);
    if (!cred || get().checkingIds[id]) return;
    set({ checkingIds: { ...get().checkingIds, [id]: true } });
    try {
      const result = (await fetchJson("/api/rdp/check", {
        method: "POST",
        body: JSON.stringify({ id }),
      })) as { credential: CredentialDTO };
      const updated = result.credential;
      set({
        credentials: get().credentials.map((c) => (c.id === updated.id ? updated : c)),
      });
      const latencyText = updated.latency != null ? `${updated.latency}ms` : "unreachable";
      toast.success(`Probed ${updated.host}:${updated.port} — ${updated.status} (${latencyText})`);
      notify(`Probed ${updated.host}: ${updated.status}`, get().settings);
      await get().loadHistory(id, false);
    } catch (err) {
      toast.error("Check error: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      const next = { ...get().checkingIds };
      delete next[id];
      set({ checkingIds: next });
      void get().fetchActivities();
    }
  },

  loadHistory: async (id, notifyUser = true) => {
    try {
      const hist = (await fetchJson(`/api/rdp/history/${encodeURIComponent(id)}`)) as {
        records: ProbeRecordDTO[];
      };
      set({ historyCache: { ...get().historyCache, [id]: hist.records } });
      if (notifyUser) toast.success("Probe history retrieved from backend.");
    } catch (err) {
      if (notifyUser) toast.error("History load error: " + (err instanceof Error ? err.message : "unknown"));
    }
  },

  saveSettings: async (patch) => {
    const merged = { ...get().settings, ...patch };
    try {
      const result = (await fetchJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify(merged),
      })) as { settings: ConsoleSettings };
      applyTheme(result.settings.theme);
      const intervalChanged = result.settings.probeIntervalSec !== get().settings.probeIntervalSec;
      set({
        settings: result.settings,
        countdownSec: intervalChanged ? result.settings.probeIntervalSec : get().countdownSec,
      });
      if (
        result.settings.desktopNotifications &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        try {
          await Notification.requestPermission();
        } catch {
          /* ignore */
        }
      }
      toast.success("Settings successfully saved and active.");
      void get().fetchActivities();
      return true;
    } catch (err) {
      toast.error("Failed to save settings: " + (err instanceof Error ? err.message : "unknown"));
      return false;
    }
  },

  clearActivities: async () => {
    try {
      await fetchJson("/api/activities", { method: "DELETE" });
      set({ activities: [] });
      toast.info("Operational log cleared.");
    } catch (err) {
      toast.error("Failed to clear log: " + (err instanceof Error ? err.message : "unknown"));
    }
  },

  clearProbeData: async () => {
    try {
      const result = (await fetchJson("/api/rdp/reset", {
        method: "POST",
        body: JSON.stringify({ scope: "probes" }),
      })) as { credentials: CredentialDTO[] };
      set({
        credentials: result.credentials,
        selectedId: null,
        historyCache: {},
      });
      toast.info("Probe history cleared — all statuses reset to unknown.");
      void get().fetchActivities();
    } catch (err) {
      toast.error("Clear failed: " + (err instanceof Error ? err.message : "unknown"));
    }
  },

  clearAllData: async () => {
    try {
      const result = (await fetchJson("/api/rdp/reset", {
        method: "POST",
        body: JSON.stringify({ scope: "all" }),
      })) as { credentials: CredentialDTO[] };
      set({
        credentials: result.credentials,
        activities: [],
        selectedId: null,
        historyCache: {},
        settings: { ...DEFAULT_SETTINGS },
        countdownSec: DEFAULT_SETTINGS.probeIntervalSec,
      });
      applyTheme("dark");
      toast.warning("Console data cleared. Vault credentials were preserved.");
    } catch (err) {
      toast.error("Clear-all failed: " + (err instanceof Error ? err.message : "unknown"));
    }
  },

  // --- access vault ---------------------------------------------------------

  addCredential: async (input) => {
    try {
      const result = (await fetchJson("/api/rdp/credentials", {
        method: "POST",
        body: JSON.stringify(input),
      })) as { credential: CredentialDTO };
      set({ credentials: [...get().credentials, result.credential] });
      toast.success(`Vault entry added for ${result.credential.host}.`);
      void get().fetchActivities();
      return true;
    } catch (err) {
      toast.error("Failed to add credential: " + (err instanceof Error ? err.message : "unknown"));
      return false;
    }
  },

  updateCredential: async (id, input) => {
    try {
      const result = (await fetchJson(`/api/rdp/credentials/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      })) as { credential: CredentialDTO };
      set({
        credentials: get().credentials.map((c) =>
          c.id === result.credential.id ? result.credential : c
        ),
      });
      toast.success(`Vault entry updated for ${result.credential.host}.`);
      void get().fetchActivities();
      return true;
    } catch (err) {
      toast.error("Failed to update credential: " + (err instanceof Error ? err.message : "unknown"));
      return false;
    }
  },

  deleteCredential: async (id) => {
    const cred = get().credentials.find((c) => c.id === id);
    if (!cred || get().credBusyIds[id]) return;
    set({ credBusyIds: { ...get().credBusyIds, [id]: true } });
    try {
      await fetchJson(`/api/rdp/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
      const historyCache = { ...get().historyCache };
      delete historyCache[id];
      set({
        credentials: get().credentials.filter((c) => c.id !== id),
        historyCache,
        selectedId: get().selectedId === id ? null : get().selectedId,
      });
      toast.info(`Vault entry removed: ${cred.host}.`);
      void get().fetchActivities();
    } catch (err) {
      toast.error("Failed to remove credential: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      const next = { ...get().credBusyIds };
      delete next[id];
      set({ credBusyIds: next });
    }
  },

  applyCredentials: (credentials) => set({ credentials }),

  /** Silent vault + audit refresh after a custom mutation flow (e.g. Add & Verify). */
  refreshAfterMutation: async () => {
    try {
      const vault = (await fetchJson("/api/rdp/credentials")) as {
        credentials: CredentialDTO[];
      };
      set({ credentials: vault.credentials });
    } catch {
      /* non-fatal — the mutation response usually carries fresh data anyway */
    }
    void get().fetchActivities();
  },

  importCredentials: async (text, mode) => {
    try {
      const result = (await fetchJson("/api/rdp/credentials/import", {
        method: "POST",
        body: JSON.stringify({ text, mode }),
      })) as {
        imported: number;
        failed: string[];
        credentials: CredentialDTO[];
      };
      set({ credentials: result.credentials });
      if (result.failed.length > 0) {
        toast.warning(
          `Imported ${result.imported} credentials; ${result.failed.length} line(s) could not be parsed.`,
          {
            description: result.failed
              .slice(0, 3)
              .map((f: unknown) =>
                typeof f === "string" ? f : ((f as { raw?: string })?.raw ?? "")
              )
              .filter(Boolean)
              .join(" | "),
          }
        );
      } else {
        toast.success(
          `Imported ${result.imported} credential${result.imported === 1 ? "" : "s"} (${mode}).`
        );
      }
      void get().fetchActivities();
      return true;
    } catch (err) {
      toast.error("Import failed: " + (err instanceof Error ? err.message : "unknown"));
      return false;
    }
  },
}));

// --- selectors / pure helpers ------------------------------------------------

export function filterAndSortFleet(
  credentials: CredentialDTO[],
  filters: ConsoleFilters
): CredentialDTO[] {
  const q = filters.search.toLowerCase().trim();
  const list = credentials.filter((c) => {
    if (filters.status !== "all" && c.status !== filters.status) return false;
    if (filters.domain !== "all" && (c.domain || "local") !== filters.domain) return false;
    if (q) {
      const inHost = (c.host || "").toLowerCase().includes(q);
      const inDomain = (c.domain || "").toLowerCase().includes(q);
      const inUser = (c.username || "").toLowerCase().includes(q);
      const inNotes = (c.notes || "").toLowerCase().includes(q);
      const inPort = String(c.port || "").includes(q);
      if (!inHost && !inDomain && !inUser && !inNotes && !inPort) return false;
    }
    return true;
  });

  return list.sort((a, b) => {
    switch (filters.sort) {
      case "name_asc":
        return (
          (a.domain || "").localeCompare(b.domain || "") ||
          (a.host || "").localeCompare(b.host || "")
        );
      case "name_desc":
        return (
          (b.domain || "").localeCompare(a.domain || "") ||
          (b.host || "").localeCompare(a.host || "")
        );
      case "latency_asc":
        return (a.latency ?? 99999) - (b.latency ?? 99999);
      case "latency_desc":
        return (b.latency ?? -1) - (a.latency ?? -1);
      case "status_asc":
        return (a.status || "").localeCompare(b.status || "");
      default:
        return 0;
    }
  });
}

export function computeMetrics(credentials: CredentialDTO[]) {
  let online = 0;
  let degraded = 0;
  let offline = 0;
  let unknown = 0;
  let totalLat = 0;
  let countLat = 0;
  credentials.forEach((c) => {
    const s = (c.status || "unknown").toLowerCase() as EndpointStatus;
    if (s === "online") online++;
    else if (s === "degraded") degraded++;
    else if (s === "offline") offline++;
    else unknown++;
    if (typeof c.latency === "number" && c.latency >= 0) {
      totalLat += c.latency;
      countLat++;
    }
  });
  return {
    total: credentials.length,
    online,
    degraded,
    offline,
    unknown,
    avgLatency: countLat > 0 ? Math.round(totalLat / countLat) : null,
  };
}

// --- vault selectors ---------------------------------------------------------

export function filterAndSortCredentials(
  credentials: CredentialDTO[],
  filters: VaultFilters
): CredentialDTO[] {
  const q = filters.search.toLowerCase().trim();
  const list = credentials.filter((c) => {
    if (filters.domain !== "all" && (c.domain || "local") !== filters.domain) return false;
    if (q) {
      const inHost = (c.host || "").toLowerCase().includes(q);
      const inDomain = (c.domain || "").toLowerCase().includes(q);
      const inUser = (c.username || "").toLowerCase().includes(q);
      const inNotes = (c.notes || "").toLowerCase().includes(q);
      const inPort = String(c.port || "").includes(q);
      if (!inHost && !inDomain && !inUser && !inNotes && !inPort) return false;
    }
    return true;
  });

  return list.sort((a, b) => {
    switch (filters.sort) {
      case "domain_asc":
        return (
          (a.domain || "").localeCompare(b.domain || "") ||
          (a.host || "").localeCompare(b.host || "")
        );
      case "host_asc":
        return (a.host || "").localeCompare(b.host || "");
      case "host_desc":
        return (b.host || "").localeCompare(a.host || "");
      case "user_asc":
        return (
          (a.username || "").localeCompare(b.username || "") ||
          (a.domain || "").localeCompare(b.domain || "")
        );
      case "recent":
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      default:
        return 0;
    }
  });
}

export function computeVaultStats(credentials: CredentialDTO[]) {
  const domains = new Set<string>();
  const hosts = new Set<string>();
  let port3389 = 0;
  let totalCores = 0;
  let coresKnown = 0;
  let totalRam = 0;
  let ramKnown = 0;
  credentials.forEach((c) => {
    if (c.domain) domains.add(c.domain);
    hosts.add(`${c.host}:${c.port}`);
    if (c.port === 3389) port3389++;
    if (typeof c.cores === "number" && c.cores > 0) {
      totalCores += c.cores;
      coresKnown++;
    }
    if (typeof c.ramGb === "number" && c.ramGb > 0) {
      totalRam += c.ramGb;
      ramKnown++;
    }
  });
  return {
    total: credentials.length,
    domains: domains.size,
    uniqueHosts: hosts.size,
    rdpPort: port3389,
    totalCores: coresKnown > 0 ? totalCores : null,
    coresKnown,
    totalRamGb: ramKnown > 0 ? totalRam : null,
    ramKnown,
  };
}

export function credentialToLine(c: CredentialDTO): string {
  return `${c.host}:${c.port}@${c.domain}\\${c.username};${c.password}`;
}

export function credentialSpecsLabel(c: { cores: number | null; ramGb: number | null }): string {
  const parts: string[] = [];
  if (typeof c.cores === "number" && c.cores > 0) parts.push(`${c.cores} vCPU`);
  if (typeof c.ramGb === "number" && c.ramGb > 0) parts.push(`${c.ramGb} GB RAM`);
  return parts.join(" · ");
}

/** True while the machine's monitor agent reported within the freshness window. */
export function agentIsFresh(c: {
  lastAgentReportAt: string | null;
  agentToken: string | null;
}): boolean {
  if (!c.agentToken || !c.lastAgentReportAt) return false;
  return Date.now() - new Date(c.lastAgentReportAt).getTime() < AGENT_FRESH_MS;
}

/** Humanized machine uptime from agent telemetry, e.g. "12d 4h". */
export function uptimeLabel(sec: number | null): string {
  if (typeof sec !== "number" || sec <= 0) return "--";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
