// Shared types for the Remote Desktop Operations Console.
// Used by both API routes (backend) and React components (frontend).
//
// Demo mode has been removed: the fleet IS the Access Vault — every server
// shown on the dashboard is a real credential entry probed over real TCP.

export type EndpointStatus = "online" | "degraded" | "offline" | "unknown";

export interface ProbeRecordDTO {
  id: string;
  credentialId: string;
  status: EndpointStatus;
  latency: number | null;
  timestamp: string; // ISO timestamp
}

export interface ActivityDTO {
  id: string;
  text: string;
  timestamp: string; // ISO timestamp
}

export interface ConsoleSettings {
  probeIntervalSec: number;
  desktopNotifications: boolean;
  theme: "dark" | "light";
}

// --- Access Vault (credential manager) --------------------------------------
//
// Each credential doubles as a fleet node for the dashboard: it carries the
// latest probe status/latency alongside the operator-supplied hardware specs.

export interface CredentialDTO {
  id: string;
  host: string;
  port: number;
  domain: string;
  username: string;
  password: string;
  notes: string;
  cores: number | null; // vCPU count (operator supplied)
  ramGb: number | null; // RAM in GB (operator supplied)
  status: EndpointStatus;
  latency: number | null; // ms of the last TCP probe
  lastChecked: string | null; // ISO timestamp
  osName: string | null; // friendly Windows product name (auto-detected via CredSSP or agent)
  osVersion: string | null; // raw NTLM product version, e.g. "10.0.20348"
  computerName: string | null; // NetBIOS computer name leaked by the NTLM challenge / agent CSName

  // Monitor agent telemetry (self-reported by the Windows agent via POST /api/rdp/agent/report)
  agentToken: string | null; // bearer token the agent presents
  lastAgentReportAt: string | null; // ISO timestamp of the last accepted agent report
  cpuLoad: number | null; // last reported CPU usage %
  memUsedPercent: number | null; // last reported physical memory usage %
  uptimeSec: number | null; // last reported machine uptime in seconds

  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// Payload accepted by POST /api/rdp/agent/report (the Windows monitor agent).
export interface AgentReportInput {
  token: string;
  cores?: number | null;
  ramMb?: number | null;
  osName?: string | null;
  osVersion?: string | null;
  computerName?: string | null;
  cpuLoad?: number | null;
  memUsedPercent?: number | null;
  uptimeSec?: number | null;
}

export interface NewCredentialInput {
  host: string;
  port: number;
  domain: string;
  username: string;
  password: string;
  notes?: string;
  cores?: number | null;
  ramGb?: number | null;
}

/** An agent report is considered stale after this many milliseconds. */
export const AGENT_FRESH_MS = 90_000;

export type VaultSort = "domain_asc" | "host_asc" | "host_desc" | "user_asc" | "recent";

export interface VaultFilters {
  search: string;
  domain: string; // "all" or domain name
  sort: VaultSort;
  revealAll: boolean;
}

// NOTE: no default credentials are shipped in source — a fresh deployment
// starts with an empty vault and the operator imports their own fleet via the
// Add Servers panel. Never hardcode credentials into source files.

export const STATUS_ORDER: EndpointStatus[] = ["online", "degraded", "offline", "unknown"];

export const DEFAULT_SETTINGS: ConsoleSettings = {
  probeIntervalSec: 30,
  desktopNotifications: false,
  theme: "dark",
};
