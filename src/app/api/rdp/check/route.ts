import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCredentialDTO } from "@/lib/credential-service";
import { logActivity, recordCredentialProbe } from "@/lib/rdp-service";
import { tcpProbe } from "@/lib/probe";
import { nlaDetect } from "@/lib/nla-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/rdp/check { id } -> { credential }
// Real TCP probe of one server; when the port answers, a CredSSP (NLA)
// banner grab identifies the Windows product version and NetBIOS
// computer name without any authentication.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const id = typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id : null;
    if (!id) {
      return NextResponse.json({ message: "Missing server id." }, { status: 400 });
    }

    const cred = await db.credential.findUnique({ where: { id } });
    if (!cred) {
      return NextResponse.json({ message: "Server not found." }, { status: 404 });
    }

    const result = await tcpProbe(cred.host, cred.port);
    const nla =
      result.status === "offline"
        ? null
        : await nlaDetect(cred.host, cred.port, {
            connectTimeoutMs: 2500,
            tlsTimeoutMs: 2000,
            challengeTimeoutMs: 2000,
          });
    await recordCredentialProbe(cred.id, result, nla);

    const detected = nla?.osVersion
      ? ` — ${nla.osName ?? "Windows"} (${nla.osVersion})${nla.computerName ? ` @ ${nla.computerName}` : ""}`
      : "";
    await logActivity(
      `Probe: ${cred.host}:${cred.port} is ${result.status} (${result.latency != null ? `${result.latency}ms` : "unreachable"})${detected}`
    );

    const updated = await db.credential.findUnique({ where: { id } });
    return NextResponse.json({
      credential: updated ? toCredentialDTO(updated) : toCredentialDTO(cred),
    });
  } catch (error) {
    console.error("[api/rdp/check] POST failed:", error);
    return NextResponse.json({ message: "Probe check failed." }, { status: 500 });
  }
}
