// POST /api/rdp/agent/report
// Ingest endpoint for the Windows monitor agent. The agent authenticates with
// its per-server bearer token and self-reports hardware specs + live metrics.
//
// Body (AgentReportInput):
//   token (required), cores?, ramMb?, osName?, osVersion?, computerName?,
//   cpuLoad?, memUsedPercent?, uptimeSec?
//
// Effects:
//   - fills cores/ramGb/osName/osVersion/computerName when the agent provides them
//     (authoritative, comes from inside the machine)
//   - stores live telemetry (cpuLoad / memUsedPercent / uptimeSec / lastAgentReportAt)
//   - does NOT touch TCP probe status/latency — reachability stays measured by real probes
//   - activity-logs the FIRST report and any spec change (throttled, no 30s spam)

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STR = 120;

// In-memory throttle: remember the last logged signature per credential so a
// 30s heartbeat does not flood the Operational Activity feed.
const lastLoggedSignature = new Map<string, string>();

function clampInt(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_STR) : null;
}

function humanUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (parts.length < 2) parts.push(`${m}m`);
  return parts.join(" ");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.token !== "string" || !body.token.trim()) {
      return NextResponse.json({ message: "token is required." }, { status: 400 });
    }
    const token = body.token.trim();

    const cred = await db.credential.findUnique({ where: { agentToken: token } });
    if (!cred) {
      return NextResponse.json({ message: "Unknown agent token." }, { status: 404 });
    }

    // --- validate & clamp ---------------------------------------------------
    const cores = clampInt(body.cores, 1, 4096);
    const ramMb = clampInt(body.ramMb, 64, 33_554_432); // up to 32 TB in MB
    const ramGb = ramMb != null ? Math.max(1, Math.round(ramMb / 1024)) : null;
    const osName = cleanStr(body.osName);
    const osVersion = cleanStr(body.osVersion);
    const computerName = cleanStr(body.computerName);
    const cpuLoad = clampInt(body.cpuLoad, 0, 100);
    const memUsedPercent = clampInt(body.memUsedPercent, 0, 100);
    const uptimeSec = clampInt(body.uptimeSec, 0, 2_147_483_647);

    const now = new Date();
    const updated = await db.credential.update({
      where: { id: cred.id },
      data: {
        lastAgentReportAt: now,
        ...(cores != null ? { cores } : {}),
        ...(ramGb != null ? { ramGb } : {}),
        ...(osName ? { osName } : {}),
        ...(osVersion ? { osVersion } : {}),
        ...(computerName ? { computerName } : {}),
        ...(cpuLoad != null ? { cpuLoad } : {}),
        ...(memUsedPercent != null ? { memUsedPercent } : {}),
        ...(uptimeSec != null ? { uptimeSec } : {}),
      },
    });

    // --- throttled activity log ---------------------------------------------
    const specs: string[] = [];
    if (updated.cores) specs.push(`${updated.cores} vCPU`);
    if (updated.ramGb) specs.push(`${updated.ramGb} GB RAM`);
    if (updated.osName) specs.push(updated.osName);
    const live: string[] = [];
    if (cpuLoad != null) live.push(`CPU ${cpuLoad}%`);
    if (memUsedPercent != null) live.push(`MEM ${memUsedPercent}%`);
    if (uptimeSec != null) live.push(`up ${humanUptime(uptimeSec)}`);
    const signature = [...specs, ...live].join(" | ");

    const shouldLog =
      !lastLoggedSignature.has(cred.id) || lastLoggedSignature.get(cred.id) !== signature;
    if (shouldLog && (specs.length > 0 || live.length > 0)) {
      lastLoggedSignature.set(cred.id, signature);
      const label = computerName ?? cred.host;
      await logActivity(
        `Agent report: ${label} (${cred.host}:${cred.port}) — ${specs.join(" · ")}${
          specs.length && live.length ? " · " : ""
        }${live.join(" · ")}`.replace(/ —\s*$/, "")
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[agent/report] failed:", err);
    return NextResponse.json({ message: "Failed to record agent report." }, { status: 500 });
  }
}
