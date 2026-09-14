// Shared server-side helpers for the Remote Desktop Operations Console.
// Only imported by API route handlers (server side).
// All probing is real TCP — demo/simulated probing was removed.

import type { Activity, Credential, ProbeRecord } from "@prisma/client";
import {
  DEFAULT_SETTINGS,
  type ActivityDTO,
  type ConsoleSettings,
  type EndpointStatus,
  type ProbeRecordDTO,
} from "@/lib/console-types";
import { db } from "@/lib/db";
import type { ProbeResult } from "@/lib/probe";
import type { NlaInfo } from "@/lib/nla-probe";

const SETTINGS_KEY = "console_settings";
const MAX_PROBE_RECORDS_PER_CREDENTIAL = 50;
const MAX_ACTIVITY_LENGTH = 500;

// ---------------------------------------------------------------------------
// DTO mappers
// ---------------------------------------------------------------------------

export function toCredentialProbeDTO(cred: Credential) {
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
    status: cred.status as EndpointStatus,
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

export function toProbeRecordDTO(rec: ProbeRecord): ProbeRecordDTO {
  return {
    id: rec.id,
    credentialId: rec.credentialId,
    status: rec.status as EndpointStatus,
    latency: rec.latency,
    timestamp: rec.timestamp.toISOString(),
  };
}

export function toActivityDTO(activity: Activity): ActivityDTO {
  return {
    id: activity.id,
    text: activity.text,
    timestamp: activity.timestamp.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Probe persistence
// ---------------------------------------------------------------------------

/** Runs async work over items with a bounded number of concurrent tasks. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Persists a real probe result for a credential and keeps history bounded.
 * When NLA detection succeeded, the discovered Windows product version and
 * NetBIOS computer name are stored too (previous values survive failures).
 */
export async function recordCredentialProbe(
  credentialId: string,
  result: ProbeResult,
  nla?: NlaInfo | null
): Promise<void> {
  const osPatch: Record<string, string> = {};
  if (nla?.osVersion) {
    osPatch.osVersion = nla.osVersion;
    if (nla.osName) osPatch.osName = nla.osName;
  }
  if (nla?.computerName) {
    osPatch.computerName = nla.computerName;
  }

  await db.$transaction(async (tx) => {
    await tx.credential.update({
      where: { id: credentialId },
      data: {
        status: result.status,
        latency: result.latency,
        lastChecked: new Date(),
        ...osPatch,
      },
    });
    await tx.probeRecord.create({
      data: {
        credentialId,
        status: result.status,
        latency: result.latency,
      },
    });
    const records = await tx.probeRecord.findMany({
      where: { credentialId },
      orderBy: { timestamp: "desc" },
      skip: MAX_PROBE_RECORDS_PER_CREDENTIAL,
      select: { id: true },
    });
    if (records.length > 0) {
      await tx.probeRecord.deleteMany({
        where: { id: { in: records.map((r) => r.id) } },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export async function logActivity(text: string): Promise<void> {
  const trimmed = (text ?? "").trim().slice(0, MAX_ACTIVITY_LENGTH);
  if (!trimmed) return;
  await db.activity.create({ data: { text: trimmed } });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeSettings(raw: unknown): ConsoleSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    probeIntervalSec:
      typeof r.probeIntervalSec === "number" && Number.isFinite(r.probeIntervalSec)
        ? clampInt(r.probeIntervalSec, 10, 86400)
        : DEFAULT_SETTINGS.probeIntervalSec,
    desktopNotifications:
      typeof r.desktopNotifications === "boolean" ? r.desktopNotifications : false,
    theme: r.theme === "light" ? "light" : "dark",
  };
}

export async function getSettings(): Promise<ConsoleSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: unknown): Promise<ConsoleSettings> {
  const current = await getSettings();
  const merged = normalizeSettings({ ...current, ...(patch as object) });
  await db.setting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: JSON.stringify(merged) },
    create: { key: SETTINGS_KEY, value: JSON.stringify(merged) },
  });
  return merged;
}
