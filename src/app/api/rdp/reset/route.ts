import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCredentialDTO } from "@/lib/credential-service";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/rdp/reset { scope: "probes" | "all" }
// probes -> clear probe history + reset statuses (vault credentials untouched)
// all    -> also wipe the activity log and settings
// Credentials are NEVER deleted here — the fleet is operator data.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const scope = (body as { scope?: unknown })?.scope === "all" ? "all" : "probes";

    await db.probeRecord.deleteMany({});
    await db.credential.updateMany({
      data: { status: "unknown", latency: null, lastChecked: null },
    });

    if (scope === "all") {
      await db.activity.deleteMany({});
      await db.setting.deleteMany({});
      await logActivity("Console data cleared: probe history, activity log, and settings were reset.");
    } else {
      await logActivity("Probe history cleared; all server statuses reset to unknown.");
    }

    const credentials = await db.credential.findMany({
      orderBy: [{ domain: "asc" }, { host: "asc" }],
    });
    return NextResponse.json({ ok: true, credentials: credentials.map(toCredentialDTO) });
  } catch (error) {
    console.error("[api/rdp/reset] POST failed:", error);
    return NextResponse.json({ message: "Reset failed." }, { status: 500 });
  }
}
