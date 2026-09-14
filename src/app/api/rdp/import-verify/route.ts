import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  CREDENTIALS_LIMIT,
  ensureCredentialsSeeded,
  parseCredentialText,
  toCredentialDTO,
  credentialKey,
} from "@/lib/credential-service";
import { logActivity, mapWithConcurrency } from "@/lib/rdp-service";
import { tcpProbe } from "@/lib/probe";
import { nlaDetect } from "@/lib/nla-probe";
import type { EndpointStatus } from "@/lib/console-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Real reachability probing of a whole batch takes a while — give it room.
export const maxDuration = 120;

const verifySchema = z.object({
  text: z.string().min(1).max(100_000),
});

/** Hard cap per request so a huge paste cannot stall the probe pipeline. */
const MAX_BATCH = 50;

type Outcome = "added" | "duplicate" | "invalid" | "limit";

export interface ImportVerifyRow {
  index: number;
  raw: string;
  outcome: Outcome;
  reason?: string;
  host?: string;
  port?: number;
  domain?: string;
  username?: string;
  id?: string;
  status?: EndpointStatus;
  latency?: number | null;
  osName?: string | null;
  osVersion?: string | null;
  computerName?: string | null;
}

interface PlannedRow {
  index: number;
  raw: string;
  entry: {
    host: string;
    port: number;
    domain: string;
    username: string;
    password: string;
  };
}

// POST /api/rdp/import-verify  { text }
// The "Add Servers" pipeline: parse -> dedupe (vault + batch) -> REAL TCP probe
// (with CredSSP/NLA banner grab for Windows product + NetBIOS name) -> insert
// each server into the vault WITH its live status, so verified servers appear
// on the dashboard immediately.
// -> { results: ImportVerifyRow[], summary, credentials }
export async function POST(request: Request) {
  try {
    await ensureCredentialsSeeded();

    const body = await request.json().catch(() => null);
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid payload: provide non-empty 'text'." },
        { status: 400 }
      );
    }

    const { entries, failed } = parseCredentialText(parsed.data.text);

    const results: ImportVerifyRow[] = failed.map((f, i) => ({
      index: i,
      raw: f.raw ?? "",
      outcome: "invalid" as const,
      reason: f.reason ?? "unparseable line",
    }));

    // --- dedupe: within the batch, then against the existing vault -----------
    const existing = await db.credential.findMany({
      select: { id: true, host: true, port: true, username: true },
    });
    const existingKeys = new Map<string, string>();
    for (const c of existing) {
      existingKeys.set(credentialKey(c.host, c.port, c.username), c.id);
    }

    const batchKeys = new Set<string>();
    const planned: PlannedRow[] = [];
    let rowCounter = results.length;

    for (const entry of entries) {
      const raw = `${entry.host}:${entry.port}@${entry.domain}\\${entry.username};***`;
      const key = credentialKey(entry.host, entry.port, entry.username);

      if (existingKeys.has(key)) {
        results.push({
          index: rowCounter++,
          raw,
          outcome: "duplicate",
          reason: "already in the vault",
          host: entry.host,
          port: entry.port,
          domain: entry.domain,
          username: entry.username,
        });
        continue;
      }
      if (batchKeys.has(key)) {
        results.push({
          index: rowCounter++,
          raw,
          outcome: "duplicate",
          reason: "repeated in this batch",
          host: entry.host,
          port: entry.port,
          domain: entry.domain,
          username: entry.username,
        });
        continue;
      }
      batchKeys.add(key);
      planned.push({ index: rowCounter++, raw, entry });
    }

    // --- respect the vault size limit ----------------------------------------
    const currentCount = await db.credential.count();
    const room = Math.max(0, CREDENTIALS_LIMIT - currentCount);
    const roomCapped = planned.slice(0, Math.min(room, MAX_BATCH));
    const overflow = planned.slice(roomCapped.length);
    for (const row of overflow) {
      const overflowIdx = planned.indexOf(row);
      results.push({
        index: row.index,
        raw: row.raw,
        outcome: "limit",
        reason:
          overflowIdx >= room
            ? `vault limit reached (max ${CREDENTIALS_LIMIT})`
            : `batch limit reached (max ${MAX_BATCH} per run)`,
        host: row.entry.host,
        port: row.entry.port,
        domain: row.entry.domain,
        username: row.entry.username,
      });
    }

    // --- probe + insert with bounded concurrency ------------------------------
    await mapWithConcurrency(roomCapped, 6, async (row) => {
      const { entry } = row;
      const probe = await tcpProbe(entry.host, entry.port, 3000);
      const nla =
        probe.status === "offline"
          ? null
          : await nlaDetect(entry.host, entry.port, {
              connectTimeoutMs: 2500,
              tlsTimeoutMs: 2000,
              challengeTimeoutMs: 2000,
            });

      const created = await db.credential.create({
        data: {
          host: entry.host,
          port: entry.port,
          domain: entry.domain,
          username: entry.username,
          password: entry.password,
          notes: "",
          status: probe.status,
          latency: probe.latency,
          lastChecked: new Date(),
          osName: nla?.osName ?? null,
          osVersion: nla?.osVersion ?? null,
          computerName: nla?.computerName ?? null,
        },
      });
      await db.probeRecord.create({
        data: {
          credentialId: created.id,
          status: probe.status,
          latency: probe.latency,
        },
      });

      results.push({
        index: row.index,
        raw: row.raw,
        outcome: "added",
        host: entry.host,
        port: entry.port,
        domain: entry.domain,
        username: entry.username,
        id: created.id,
        status: probe.status,
        latency: probe.latency,
        osName: nla?.osName ?? null,
        osVersion: nla?.osVersion ?? null,
        computerName: nla?.computerName ?? null,
      });
    });

    results.sort((a, b) => a.index - b.index);

    const summary = {
      totalLines: results.length,
      added: results.filter((r) => r.outcome === "added").length,
      reachable: results.filter(
        (r) => r.outcome === "added" && r.status !== "offline"
      ).length,
      duplicates: results.filter((r) => r.outcome === "duplicate").length,
      invalid: results.filter((r) => r.outcome === "invalid").length,
      limited: results.filter((r) => r.outcome === "limit").length,
    };

    if (summary.added > 0) {
      await logActivity(
        `Add & verify: ${summary.added} new server(s) deployed to the dashboard — ` +
          `${summary.reachable} reachable, ${summary.duplicates} duplicate(s) skipped, ` +
          `${summary.invalid} invalid line(s).`
      );
    }

    const credentials = await db.credential.findMany({
      orderBy: [{ domain: "asc" }, { host: "asc" }],
    });

    return NextResponse.json({
      results,
      summary,
      credentials: credentials.map(toCredentialDTO),
    });
  } catch (error) {
    console.error("[api/rdp/import-verify] POST failed:", error);
    return NextResponse.json(
      { message: "Add & verify pipeline failed." },
      { status: 500 }
    );
  }
}
