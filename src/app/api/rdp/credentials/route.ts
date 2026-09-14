import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  CREDENTIALS_LIMIT,
  ensureCredentialsSeeded,
  toCredentialDTO,
  validateCredentialInput,
} from "@/lib/credential-service";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/rdp/credentials -> { credentials: CredentialDTO[] }
export async function GET() {
  try {
    await ensureCredentialsSeeded();
    const credentials = await db.credential.findMany({
      orderBy: [{ domain: "asc" }, { host: "asc" }],
    });
    return NextResponse.json({ credentials: credentials.map(toCredentialDTO) });
  } catch (error) {
    console.error("[api/rdp/credentials] GET failed:", error);
    return NextResponse.json({ message: "Failed to load credential vault." }, { status: 500 });
  }
}

// POST /api/rdp/credentials -> 201 { credential: CredentialDTO }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const validated = validateCredentialInput(body);
    if (!validated.ok) {
      return NextResponse.json({ message: validated.error }, { status: 400 });
    }

    const count = await db.credential.count();
    if (count >= CREDENTIALS_LIMIT) {
      return NextResponse.json(
        { message: `Vault limit reached (max ${CREDENTIALS_LIMIT} credentials).` },
        { status: 400 }
      );
    }

    const created = await db.credential.create({ data: validated.value });

    await logActivity(
      `Vault entry added: ${validated.value.domain}\\${validated.value.username} @ ${validated.value.host}:${validated.value.port}`
    );

    return NextResponse.json({ credential: toCredentialDTO(created) }, { status: 201 });
  } catch (error) {
    console.error("[api/rdp/credentials] POST failed:", error);
    return NextResponse.json({ message: "Failed to add vault entry." }, { status: 500 });
  }
}
