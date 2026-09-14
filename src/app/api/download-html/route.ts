import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

// Forced-download endpoint for the full static HTML export.
// Always responds with Content-Disposition: attachment so Chrome downloads
// the file instead of rendering it — works even when a plain <a download>
// link is stripped of its semantics by embedders/proxies.
export async function GET() {
  try {
    const file = path.join(process.cwd(), "public", "access-vault.html");
    const html = await readFile(file, "utf8");
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": 'attachment; filename="access-vault.html"',
        "Content-Length": String(Buffer.byteLength(html)),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Snapshot not found — ask the assistant to re-export it." },
      { status: 404 },
    );
  }
}
