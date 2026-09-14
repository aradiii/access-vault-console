// Pure credential-line parser — client & server safe (no db imports).
//
// Accepted per line:
//   host:port@DOMAIN\username;password
//   host@DOMAIN\username;password        (port defaults to 3389)
//   host:port@DOMAIN/username;password   (forward slash tolerated)
//   "#..." or "//..." lines are treated as comments and ignored.
//
// The password is everything after the FIRST ";" up to the end of the line,
// so passwords containing semicolons remain intact.

import type { NewCredentialInput } from "@/lib/console-types";

export interface ParsedCredentialLine {
  ok: boolean;
  entry?: NewCredentialInput;
  raw?: string;
  /** Why the line failed (for live UI feedback). */
  reason?: string;
}

export function parseCredentialLine(line: string): ParsedCredentialLine {
  const raw = line.trim();
  if (!raw) return { ok: false };
  if (raw.startsWith("#") || raw.startsWith("//")) return { ok: false, raw };

  const semiIdx = raw.indexOf(";");
  if (semiIdx === -1) return { ok: false, raw, reason: "missing ';password' part" };
  const password = raw.slice(semiIdx + 1).trim();
  if (!password) return { ok: false, raw, reason: "empty password" };

  const left = raw.slice(0, semiIdx);

  const atIdx = left.lastIndexOf("@");
  if (atIdx === -1) return { ok: false, raw, reason: "missing '@DOMAIN\\user'" };
  const hostPart = left.slice(0, atIdx).trim();
  const accountPart = left.slice(atIdx + 1).trim();

  let host = hostPart;
  let port = 3389;
  const portMatch = hostPart.match(/^(.+):(\d{1,5})$/);
  if (portMatch) {
    host = portMatch[1].trim();
    const p = Number(portMatch[2]);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return { ok: false, raw, reason: "invalid port" };
    }
    port = p;
  }
  if (!host || /\s/.test(host)) return { ok: false, raw, reason: "invalid host" };

  const bsIdx = accountPart.indexOf("\\");
  const fsIdx = accountPart.indexOf("/");
  let sepIdx = -1;
  if (bsIdx !== -1 && fsIdx !== -1) sepIdx = Math.min(bsIdx, fsIdx);
  else sepIdx = bsIdx !== -1 ? bsIdx : fsIdx;
  if (sepIdx === -1) return { ok: false, raw, reason: "missing domain\\user separator" };

  const domain = accountPart.slice(0, sepIdx).trim();
  const username = accountPart.slice(sepIdx + 1).trim();
  if (!domain) return { ok: false, raw, reason: "empty domain" };
  if (!username) return { ok: false, raw, reason: "empty username" };

  return {
    ok: true,
    entry: {
      host: host.slice(0, 120),
      port,
      domain: domain.slice(0, 80),
      username: username.slice(0, 80),
      password: password.slice(0, 200),
      notes: "",
      cores: null,
      ramGb: null,
    },
  };
}

export function parseCredentialText(text: string): {
  entries: NewCredentialInput[];
  failed: ParsedCredentialLine[];
} {
  const entries: NewCredentialInput[] = [];
  const failed: ParsedCredentialLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseCredentialLine(line);
    if (parsed.ok && parsed.entry) entries.push(parsed.entry);
    else if (parsed.raw) failed.push(parsed);
  }
  return { entries, failed };
}

/**
 * Canonical identity key used for duplicate detection everywhere
 * (live preview in the UI + server-side dedupe): host|port|username,
 * case-insensitive on the case-sensitive parts.
 */
export function credentialKey(host: string, port: number, username: string): string {
  return `${(host || "").trim().toLowerCase()}|${port}|${(username || "").trim().toLowerCase()}`;
}
