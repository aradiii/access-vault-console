import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  CREDENTIALS_LIMIT,
  ensureCredentialsSeeded,
  parseCredentialText,
  toCredentialDTO,
} from "@/lib/credential-service";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const importSchema = z.object({
  text: z.string().min(1).max(100_000),
  mode: z.enum(["append", "replace"]).default("append"),
});

// POST /api/rdp/credentials/import
// body: { text: "host:port@DOMAIN\\user;password ...", mode: "append" | "replace" }
// -> { imported: number, failed: string[], credentials: CredentialDTO[] }
export async function POST(request: Request) {
  try {
    await ensureCredentialsSeeded();

    const body = await request.json().catch(() => null);
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid import payload: provide non-empty 'text'." },
        { status: 400 }
      );
    }

    const { text, mode } = parsed.data;
    const { entries, failed } = parseCredentialText(text);

    if (entries.length === 0) {
      return NextResponse.json(
        {
          message:
            "No valid entries found. Expected lines like: 10.0.0.5:3389@DOMAIN\\user;password",
          failed,
        },
        { status: 400 }
      );
    }

    if (mode === "replace") {
      await db.credential.deleteMany({});
    }

    const currentCount = await db.credential.count();
    const room = CREDENTIALS_LIMIT - currentCount;
    if (room <= 0) {
      return NextResponse.json(
        { message: `Vault limit reached (max ${CREDENTIALS_LIMIT} credentials).` },
        { status: 400 }
      );
    }
    const accepted = entries.slice(0, room);

    await db.credential.createMany({ data: accepted });

    await logActivity(
      mode === "replace"
        ? `Vault replaced via import: ${accepted.length} credentials loaded.`
        : `Bulk import: ${accepted.length} credentials appended to the vault.`
    );

    const credentials = await db.credential.findMany({
      orderBy: [{ domain: "asc" }, { host: "asc" }],
    });

    return NextResponse.json({
      imported: accepted.length,
      failed,
      credentials: credentials.map(toCredentialDTO),
    });
  } catch (error) {
    console.error("[api/rdp/credentials/import] POST failed:", error);
    return NextResponse.json({ message: "Failed to import credentials." }, { status: 500 });
  }
}
