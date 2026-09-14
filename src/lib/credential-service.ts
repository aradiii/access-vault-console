// Server-side helpers for the Access Vault (credential manager).
// Only imported by API route handlers (server side).

import type { Credential } from "@prisma/client";
import { type CredentialDTO } from "@/lib/console-types";
import {
  credentialKey,
  parseCredentialLine,
  parseCredentialText,
  type ParsedCredentialLine,
} from "@/lib/credential-parser";

export { credentialKey, parseCredentialLine, parseCredentialText };
export type { ParsedCredentialLine };

const MAX_CREDENTIALS = 500;

// ---------------------------------------------------------------------------
// DTO mapper
// ---------------------------------------------------------------------------

export function toCredentialDTO(cred: Credential): CredentialDTO {
  return {
    id: cred.id,
    host: cred.host,
    port: cred.port,
    domain: cred.domain,
    username: cred.username,
    password: cred.password,
    notes: cred.notes,
    cores: cred.cores,
    ramGb: cred.ramGb,
    status: cred.status as CredentialDTO["status"],
    latency: cred.latency,
    lastChecked: cred.lastChecked ? cred.lastChecked.toISOString() : null,
    osName: cred.osName,
    osVersion: cred.osVersion,
    computerName: cred.computerName,
    agentToken: cred.agentToken,
    lastAgentReportAt: cred.lastAgentReportAt ? cred.lastAgentReportAt.toISOString() : null,
    cpuLoad: cred.cpuLoad,
    memUsedPercent: cred.memUsedPercent,
    uptimeSec: cred.uptimeSec,
    createdAt: cred.createdAt.toISOString(),
    updatedAt: cred.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Text format parser — implementation lives in ./credential-parser (pure,
// shared with the client-side live preview). Re-exported above for API routes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Seeding — intentionally disabled. A fresh deployment starts with an EMPTY
// vault; the operator imports their own fleet through the Add Servers panel.
// Never hardcode credentials into source (they end up in git history).
// ---------------------------------------------------------------------------

export async function ensureCredentialsSeeded(): Promise<void> {
  /* no-op — vault starts empty by design */
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidatedCredential {
  host: string;
  port: number;
  domain: string;
  username: string;
  password: string;
  notes: string;
  cores: number | null;
  ramGb: number | null;
}

function optionalInt(
  value: unknown,
  min: number,
  max: number,
  label: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error: `${label} must be an integer between ${min} and ${max}.` };
  }
  return { ok: true, value: n };
}

export function validateCredentialInput(
  body: unknown
): { ok: true; value: ValidatedCredential } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const host = String(b.host ?? "").trim();
  const port = Number(b.port ?? 3389);
  const domain = String(b.domain ?? "").trim();
  const username = String(b.username ?? "").trim();
  const password = String(b.password ?? "");
  const notes = String(b.notes ?? "").slice(0, 200);

  if (!host || host.length > 120) return { ok: false, error: "Host is required (max 120 chars)." };
  if (!/^[a-zA-Z0-9.\-_]+$/.test(host))
    return { ok: false, error: "Host may only contain letters, digits, dots, dashes and underscores." };
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { ok: false, error: "Port must be an integer between 1 and 65535." };
  if (!domain || domain.length > 80) return { ok: false, error: "Domain is required (max 80 chars)." };
  if (!username || username.length > 80) return { ok: false, error: "Username is required (max 80 chars)." };
  if (!password || password.length > 200) return { ok: false, error: "Password is required (max 200 chars)." };

  const cores = optionalInt(b.cores, 1, 4096, "CPU cores");
  if (!cores.ok) return cores;
  const ramGb = optionalInt(b.ramGb, 1, 65536, "RAM (GB)");
  if (!ramGb.ok) return ramGb;

  return {
    ok: true,
    value: { host, port, domain, username, password, notes, cores: cores.value, ramGb: ramGb.value },
  };
}

export const CREDENTIALS_LIMIT = MAX_CREDENTIALS;
