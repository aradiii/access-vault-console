import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/rdp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_URL = "http://127.0.0.1:3010";

const createSchema = z.object({
  credentialId: z.string().min(1).max(64),
  width: z.number().int().min(800).max(1920).optional(),
  height: z.number().int().min(600).max(1200).optional(),
});

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
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

export async function GET() {
  try {
    const res = await bridgeFetch("/api/sessions");
    if (!res.ok) {
      return NextResponse.json({ message: "Session bridge error" }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ message: "Session bridge is offline" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid request payload" }, { status: 400 });
  }
  const { credentialId, width, height } = parsed.data;

  const cred = await db.credential.findUnique({ where: { id: credentialId } });
  if (!cred) {
    return NextResponse.json({ message: "Credential not found" }, { status: 404 });
  }

  try {
    const res = await bridgeFetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        credentialId: cred.id,
        host: cred.host,
        port: cred.port,
        username: cred.username,
        password: cred.password,
        domain: cred.domain || "",
        width,
        height,
      }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { message?: string };
      return NextResponse.json(
        { message: detail.message ?? "Failed to launch RDP session" },
        { status: res.status === 429 ? 429 : 502 }
      );
    }
    const data = (await res.json()) as { session?: { sessionId: string } };
    if (!data.session?.sessionId) {
      return NextResponse.json({ message: "Bridge returned no session" }, { status: 502 });
    }
    await logActivity(
      `Interactive RDP session opened to ${cred.host}:${cred.port} (${cred.domain}\\${cred.username})`
    );
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json(
      { message: "Session bridge is offline — cannot launch RDP login" },
      { status: 503 }
    );
  }
}
