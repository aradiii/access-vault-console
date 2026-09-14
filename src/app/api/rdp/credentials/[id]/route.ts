import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCredentialDTO, validateCredentialInput } from "@/lib/credential-service";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT /api/rdp/credentials/:id -> { credential: CredentialDTO }
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.credential.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Credential not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const validated = validateCredentialInput(body);
    if (!validated.ok) {
      return NextResponse.json({ message: validated.error }, { status: 400 });
    }

    const updated = await db.credential.update({
      where: { id },
      data: validated.value,
    });

    await logActivity(
      `Vault entry updated: ${validated.value.domain}\\${validated.value.username} @ ${validated.value.host}:${validated.value.port}`
    );

    return NextResponse.json({ credential: toCredentialDTO(updated) });
  } catch (error) {
    console.error("[api/rdp/credentials/:id] PUT failed:", error);
    return NextResponse.json({ message: "Failed to update vault entry." }, { status: 500 });
  }
}

// DELETE /api/rdp/credentials/:id -> { ok: true }
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.credential.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Credential not found." }, { status: 404 });
    }

    await db.credential.delete({ where: { id } });

    await logActivity(
      `Vault entry removed: ${existing.domain}\\${existing.username} @ ${existing.host}:${existing.port}`
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/rdp/credentials/:id] DELETE failed:", error);
    return NextResponse.json({ message: "Failed to remove vault entry." }, { status: 500 });
  }
}
