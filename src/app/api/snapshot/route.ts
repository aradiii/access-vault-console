import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

// TEMPORARY helper for the one-off static HTML export (Task 20).
// Receives a fully assembled self-contained HTML document and writes it to
// public/access-vault.html so it can be downloaded from the site.
export async function POST(req: Request) {
  try {
    const html = await req.text();
    if (!html.includes("<html")) {
      return NextResponse.json({ ok: false, error: "Not an HTML document" }, { status: 400 });
    }
    const dir = path.join(process.cwd(), "public");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "access-vault.html"), html, "utf8");
    return NextResponse.json({ ok: true, bytes: Buffer.byteLength(html) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "write failed" },
      { status: 500 },
    );
  }
}
