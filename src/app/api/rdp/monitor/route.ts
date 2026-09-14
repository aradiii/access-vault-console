import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ensureCredentialsSeeded,
  toCredentialDTO,
} from "@/lib/credential-service";
import { logActivity, mapWithConcurrency, recordCredentialProbe } from "@/lib/rdp-service";
import { tcpProbe } from "@/lib/probe";
import { nlaDetect, type NlaInfo } from "@/lib/nla-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/rdp/monitor -> { credentials, counts }
// Probes every vault server over real TCP in parallel (persistence stays
// sequential to avoid SQLite write contention). Servers whose Windows
// product version is still unknown get a one-time CredSSP (NLA) banner
// grab so the model shows up next to the server.
export async function POST() {
  try {
    await ensureCredentialsSeeded();
    const credentials = await db.credential.findMany({ orderBy: [{ domain: "asc" }, { host: "asc" }] });

    // 1) Real TCP probes, bounded concurrency.
    const probeResults = await mapWithConcurrency(credentials, 8, (cred) =>
      tcpProbe(cred.host, cred.port)
    );

    // 2) One-time OS enrichment for reachable servers without a detected version.
    const detectable = credentials
      .map((cred, i) => ({ cred, result: probeResults[i] }))
      .filter(({ cred, result }) => result.status !== "offline" && !cred.osVersion);
    const nlaInfos = await mapWithConcurrency(detectable, 6, ({ cred }) =>
      nlaDetect(cred.host, cred.port)
    );
    const nlaById = new Map<string, NlaInfo | null>();
    detectable.forEach(({ cred }, i) => nlaById.set(cred.id, nlaInfos[i]));

    // 3) Sequential persistence.
    const counts = { online: 0, degraded: 0, offline: 0 };
    for (let i = 0; i < credentials.length; i++) {
      const cred = credentials[i];
      const result = probeResults[i];
      await recordCredentialProbe(cred.id, result, nlaById.get(cred.id) ?? null);
      if (result.status === "online") counts.online++;
      else if (result.status === "degraded") counts.degraded++;
      else counts.offline++;
    }

    const detectedCount = Array.from(nlaById.values()).filter((n) => n?.osVersion).length;
    await logActivity(
      `Fleet probe completed: ${counts.online} online, ${counts.degraded} degraded, ${counts.offline} offline of ${credentials.length} servers.` +
        (detectedCount > 0 ? ` Windows version detected on ${detectedCount} server(s).` : "")
    );

    const updated = await db.credential.findMany({ orderBy: [{ domain: "asc" }, { host: "asc" }] });
    return NextResponse.json({ credentials: updated.map(toCredentialDTO), counts });
  } catch (error) {
    console.error("[api/rdp/monitor] POST failed:", error);
    return NextResponse.json({ message: "Fleet monitoring failed." }, { status: 500 });
  }
}
