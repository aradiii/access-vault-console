import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toProbeRecordDTO } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/rdp/history/:id -> { records } (newest first, limit 20)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cred = await db.credential.findUnique({ where: { id } });
    if (!cred) {
      return NextResponse.json({ message: "Server not found." }, { status: 404 });
    }
    const records = await db.probeRecord.findMany({
      where: { credentialId: id },
      orderBy: { timestamp: "desc" },
      take: 20,
    });
    return NextResponse.json({ records: records.map(toProbeRecordDTO) });
  } catch (error) {
    console.error("[api/rdp/history/:id] GET failed:", error);
    return NextResponse.json({ message: "Failed to load probe history." }, { status: 500 });
  }
}
