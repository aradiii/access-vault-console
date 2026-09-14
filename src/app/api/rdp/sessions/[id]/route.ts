import { NextResponse } from "next/server";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_URL = "http://127.0.0.1:3010";

interface SessionMeta {
  host?: string;
  port?: number;
  username?: string;
  domain?: string;
}

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await bridgeFetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!res.ok) {
      return NextResponse.json(
        { message: res.status === 404 ? "Session not found" : "Session bridge error" },
        { status: res.status === 404 ? 404 : 502 }
      );
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ message: "Session bridge is offline" }, { status: 503 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Best-effort metadata for the audit trail before the record disappears.
  let meta: SessionMeta | null = null;
  try {
    const res = await bridgeFetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (res.ok) {
      const body = (await res.json()) as { session?: SessionMeta };
      meta = body.session ?? null;
    }
  } catch {
    /* bridge may already be gone */
  }

  try {
    const res = await bridgeFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      return NextResponse.json({ message: "Failed to stop session" }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ message: "Session bridge is offline" }, { status: 503 });
  }

  if (meta?.host) {
    await logActivity(
      `Interactive RDP session closed for ${meta.host}:${meta.port ?? 3389} (${meta.domain ?? "-"}\\${meta.username ?? "-"})`
    );
  }
  return NextResponse.json({ stopped: true });
}
