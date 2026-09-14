// POST /api/rdp/agent/token
// Issues (or rotates) the monitor-agent bearer token for one vault entry.
// Body: { credentialId: string, rotate?: boolean }
// Response: { token: string, credential: CredentialDTO }

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCredentialDTO } from "@/lib/credential-service";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function generateToken(): string {
  return randomBytes(24).toString("hex"); // 48 hex chars
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      credentialId?: unknown;
      rotate?: unknown;
    };

    const credentialId = typeof body.credentialId === "string" ? body.credentialId : "";
    if (!credentialId) {
      return NextResponse.json({ message: "credentialId is required." }, { status: 400 });
    }

    const existing = await db.credential.findUnique({ where: { id: credentialId } });
    if (!existing) {
      return NextResponse.json({ message: "Vault entry not found." }, { status: 404 });
    }

    const rotate = body.rotate === true;
    let token = existing.agentToken;

    if (!token || rotate) {
      // Ensure uniqueness even on the astronomically unlikely collision.
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateToken();
        const clash = await db.credential.findUnique({ where: { agentToken: candidate } });
        if (!clash) {
          token = candidate;
          break;
        }
      }
      if (!token) {
        return NextResponse.json(
          { message: "Could not generate a unique token, please retry." },
          { status: 500 }
        );
      }
    }

    const updated = await db.credential.update({
      where: { id: credentialId },
      data: { agentToken: token },
    });

    await logActivity(
      rotate
        ? `Monitor agent token ROTATED for ${existing.host}:${existing.port} (${existing.domain}).`
        : `Monitor agent token issued for ${existing.host}:${existing.port} (${existing.domain}).`
    );

    return NextResponse.json({ token, credential: toCredentialDTO(updated) });
  } catch (err) {
    console.error("[agent/token] failed:", err);
    return NextResponse.json({ message: "Failed to issue agent token." }, { status: 500 });
  }
}
