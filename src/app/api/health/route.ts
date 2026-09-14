import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health -> { ok: true, time }
export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
