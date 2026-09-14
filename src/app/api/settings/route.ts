import { NextResponse } from "next/server";
import { getSettings, logActivity, saveSettings } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/settings -> { settings }
export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[api/settings] GET failed:", error);
    return NextResponse.json({ message: "Failed to load settings." }, { status: 500 });
  }
}

// PUT /api/settings -> { settings }
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const settings = await saveSettings(body);
    await logActivity("System configurations updated.");
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[api/settings] PUT failed:", error);
    return NextResponse.json({ message: "Failed to save settings." }, { status: 500 });
  }
}
