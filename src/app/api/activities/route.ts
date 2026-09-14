import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, toActivityDTO } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/activities -> { activities } (newest first, limit 50)
export async function GET() {
  try {
    const activities = await db.activity.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });
    return NextResponse.json({ activities: activities.map(toActivityDTO) });
  } catch (error) {
    console.error("[api/activities] GET failed:", error);
    return NextResponse.json({ message: "Failed to load activities." }, { status: 500 });
  }
}

const postSchema = z.object({ text: z.string().trim().min(1).max(500) });

// POST /api/activities { text } -> 201 { activity }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid activity payload." }, { status: 400 });
    }
    const created = await db.activity.create({ data: { text: parsed.data.text } });
    return NextResponse.json({ activity: toActivityDTO(created) }, { status: 201 });
  } catch (error) {
    console.error("[api/activities] POST failed:", error);
    return NextResponse.json({ message: "Failed to log activity." }, { status: 500 });
  }
}

// DELETE /api/activities -> clears the log
export async function DELETE() {
  try {
    await db.activity.deleteMany({});
    await logActivity("Operational log cleared.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/activities] DELETE failed:", error);
    return NextResponse.json({ message: "Failed to clear activities." }, { status: 500 });
  }
}
