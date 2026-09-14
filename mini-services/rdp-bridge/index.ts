// Interactive RDP login bridge (port 3010, loopback only).
//
// Per session it launches:
//   1. Xvfb       — virtual X11 screen the RDP desktop renders into
//   2. xfreerdp3  — real NLA login to the target Windows host (vault credentials)
//   3. x11vnc     — exposes that screen via RFB/VNC on 127.0.0.1:<vncPort>
//
// Browser reaches it through the Caddy gateway:
//   WebSocket: /?XTransformPort=3010&session=<id>  (raw RFB bytes both directions)
//   REST:      /api/...?XTransformPort=3010        (called by the Next.js API layer)
//
// Passwords only arrive here over loopback from the Next.js backend and are
// never returned by any endpoint.

import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import type { Socket, Subprocess } from "bun";

const PORT = 3010;
const HOSTNAME = "127.0.0.1";

const RDP_ROOT = "/home/z/.local/opt/rdp/root";
const RDP_LIB = `${RDP_ROOT}/usr/lib/x86_64-linux-gnu`;
const XVFB_BIN = "/usr/bin/Xvfb";
const XFREERDP_BIN = `${RDP_ROOT}/usr/bin/xfreerdp3`;
const X11VNC_BIN = `${RDP_ROOT}/usr/bin/x11vnc`;

// Extra flags appended to every xfreerdp3 invocation (none needed: default NLA
// negotiation works — see KRB5_CONF_PATH below for the krb5 segfault fix).
const EXTRA_RDP_FLAGS: string[] = [];

// krb5 segfault fix. FreeRDP's CredSSP (NLA) tries the winpr Kerberos SSP first;
// MIT krb5 1.21 in this container SEGFAULTS in krb5int_open_plugin_dirs during
// krb5_sendto_kdc (TGT acquisition) — and KRB5_PLUGIN_DIR is NOT honored by this
// krb5 build, while a *valid* KRB5_CONFIG still reaches the crashing path.
// Proven fix: point KRB5_CONFIG at a deliberately INVALID file so
// krb5_init_context fails with KRB5_CONFIG_BADFORMAT; winpr then logs an error
// and Negotiate falls back to pure NTLM, which is all NLA needs here.
// Written at boot so every service restart has it.
const KRB5_CONF_PATH = "/tmp/rdp-krb5-broken.conf";
try {
  writeFileSync(
    KRB5_CONF_PATH,
    "### intentionally invalid krb5 config ###\n[[[ no section here\n",
    { mode: 0o644 }
  );
} catch {
  /* best effort — file may already exist */
}

const DISPLAY_BASE = 160; // :160 .. :189
const VNC_PORT_BASE = 15960; // 15960 .. 15989
const MAX_SESSIONS = 8;
const TAIL_LINES = 80;

type SessionStatus = "launching" | "live" | "error" | "closed";

interface BridgeSession {
  sessionId: string;
  credentialId: string;
  host: string;
  port: number;
  username: string;
  domain: string;
  width: number;
  height: number;
  display: number;
  vncPort: number;
  status: SessionStatus;
  startedAt: string;
  tail: string[];
  xvfb: Subprocess | null;
  rdp: Subprocess | null;
  vnc: Subprocess | null;
  watcher: ReturnType<typeof setInterval> | null;
  /** true while the domain->local fallback retry is running — the watcher
   *  must not judge process deaths or flip to live during that window. */
  retrying: boolean;
  /** first RDP failure signature seen in the rdp output, if any. */
  rdpFailReason: string | null;
}

interface WsData {
  sessionId: string;
  sock?: Socket<"vnc">;
  closed?: boolean;
}

const sessions = new Map<string, BridgeSession>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(max, Math.max(min, n));
}

function pushTail(s: BridgeSession, prefix: string, line: string): void {
  const t = line.replace(/\r$/, "");
  if (!t) return;
  // Headless-environment noise (audio/clipboard subsystems) would otherwise
  // flood the 14-line public tail and bury the actual auth/connection errors.
  if (/rdpsnd|pulseaudio|libpulse|pulse entry|cliprdr|channel ([a-z]+\) )?railed/i.test(t)) return;
  s.tail.push(`[${prefix}] ${t}`);
  if (s.tail.length > TAIL_LINES) s.tail.splice(0, s.tail.length - TAIL_LINES);
}

async function pump(
  stream: ReadableStream<Uint8Array> | undefined,
  s: BridgeSession,
  prefix: string,
  onLine?: (line: string) => void
): Promise<void> {
  if (!stream) return;
  const dec = new TextDecoder();
  let carry = "";
  // Explicit reader loop (NOT for-await): Bun's async iterator threw an
  // uncatchable AbortError (ERR_STREAM_RELEASE_LOCK) when streams were torn
  // down, which panicked the whole service under `bun --hot`.
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      let idx = carry.indexOf("\n");
      while (idx >= 0) {
        const line = carry.slice(0, idx);
        pushTail(s, prefix, line);
        onLine?.(line);
        carry = carry.slice(idx + 1);
        idx = carry.indexOf("\n");
      }
      if (carry.length > 500) {
        pushTail(s, prefix, carry);
        onLine?.(carry);
        carry = "";
      }
    }
    if (carry) {
      pushTail(s, prefix, carry);
      onLine?.(carry);
    }
  } catch {
    /* stream cancelled or closed with the process — non-fatal */
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      /* already released */
    }
  }
}

function alive(p: Subprocess | null): boolean {
  return !!p && p.exitCode === null && p.signalCode === null;
}

function killAll(s: BridgeSession): void {
  for (const key of ["rdp", "vnc", "xvfb"] as const) {
    const p = s[key];
    if (p) {
      try {
        p.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
}

function stopSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  if (s.watcher) {
    clearInterval(s.watcher);
    s.watcher = null;
  }
  killAll(s);
  sessions.delete(sessionId);
  setTimeout(() => {
    for (const key of ["rdp", "vnc", "xvfb"] as const) {
      const p = s[key];
      if (p) {
        try {
          p.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }
    }
  }, 1500);
  return true;
}

function clearXLock(display: number): void {
  for (const path of [`/tmp/.X${display}-lock`, `/tmp/.X11-unix/X${display}`]) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* best effort */
    }
  }
}

function nextSlot(): { display: number; vncPort: number } | null {
  const used = new Set<number>();
  for (const s of sessions.values()) {
    if (s.status === "launching" || s.status === "live") used.add(s.display);
  }
  for (let i = 0; i < MAX_SESSIONS; i++) {
    if (!used.has(DISPLAY_BASE + i)) {
      return { display: DISPLAY_BASE + i, vncPort: VNC_PORT_BASE + i };
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function startWatcher(s: BridgeSession): void {
  const bornAt = Date.now();
  s.watcher = setInterval(() => {
    if (s.retrying) return; // fallback retry owns the rdp process right now
    if (!alive(s.rdp) || !alive(s.vnc)) {
      if (s.watcher) {
        clearInterval(s.watcher);
        s.watcher = null;
      }
      s.status = "error";
      if (!s.tail.length) s.tail.push("[bridge] session processes exited unexpectedly");
      killAll(s);
    } else if (s.status === "launching" && Date.now() - bornAt > 5000) {
      s.status = "live";
    }
  }, 1000);
}

function publicSession(s: BridgeSession) {
  return {
    sessionId: s.sessionId,
    credentialId: s.credentialId,
    host: s.host,
    port: s.port,
    username: s.username,
    domain: s.domain,
    width: s.width,
    height: s.height,
    display: s.display,
    vncPort: s.vncPort,
    status: s.status,
    startedAt: s.startedAt,
    tail: s.tail.slice(-14),
  };
}

function sessionEnv(display: number) {
  return {
    ...process.env,
    DISPLAY: `:${display}`,
    LD_LIBRARY_PATH: RDP_LIB,
    HOME: "/home/z",
    KRB5_CONFIG: KRB5_CONF_PATH,
  };
}

function spawnRdp(s: BridgeSession, domain: string | null, password: string): Subprocess {
  const rdpArgs = [
    XFREERDP_BIN,
    `/v:${s.host}:${s.port}`,
    `/u:${s.username}`,
    `/p:${password}`,
    ...(domain ? [`/d:${domain}`] : []),
    "/cert:ignore",
    `/size:${s.width}x${s.height}`,
    "/audio-mode:0",
    "/log-level:INFO",
    ...EXTRA_RDP_FLAGS,
  ];
  return Bun.spawn(rdpArgs, { stdout: "pipe", stderr: "pipe", env: sessionEnv(s.display) });
}

/** Attaches tail pumps + the failure-signature detector to the CURRENT rdp
 *  process. Called again whenever the retry replaces the rdp process. */
function attachRdpPumps(s: BridgeSession): void {
  const hook = (line: string): void => {
    if (!s.rdpFailReason && /STATUS_NO_LOGON_SERVERS/i.test(line)) {
      s.rdpFailReason = "no-logon-servers";
    }
  };
  void pump(s.rdp?.stdout, s, "rdp", hook);
  void pump(s.rdp?.stderr, s, "rdp", hook);
}

/** Resolves once the current rdp attempt reaches a verdict:
 *  "nologon" — server reported STATUS_NO_LOGON_SERVERS (DC unreachable)
 *  "exit"    — the rdp process terminated on its own
 *  "quiet"   — budget elapsed with no failure signature (auth passed) */
function settleRdp(s: BridgeSession, budgetMs: number): Promise<"nologon" | "exit" | "quiet"> {
  return new Promise((resolve) => {
    const watched = s.rdp;
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (s.rdp !== watched) {
        clearInterval(iv);
        resolve("quiet"); // superseded by another attempt
      } else if (s.rdpFailReason) {
        clearInterval(iv);
        resolve("nologon");
      } else if (!alive(watched)) {
        clearInterval(iv);
        resolve("exit");
      } else if (Date.now() - t0 > budgetMs) {
        clearInterval(iv);
        resolve("quiet");
      }
    }, 300);
  });
}

// Domain -> local fallback: some fleet servers are AD-joined but cannot reach a
// domain controller, so DOMAIN\user dies with STATUS_NO_LOGON_SERVERS while the
// same local account (.\user) logs in fine (verified live against a fleet server).
// When the vault entry carries a domain and that signature appears, retry ONCE
// with /d:. before surfacing the failure.
async function watchRdpFallback(s: BridgeSession, password: string): Promise<void> {
  try {
    const first = await settleRdp(s, 8_000);
    if (first !== "nologon") return;
    pushTail(
      s,
      "bridge",
      `domain '${s.domain}' was rejected (NO_LOGON_SERVERS) — retrying as local account .\\${s.username}`
    );
    console.log(`[bridge] fallback: retrying ${s.host} as local account (.\\${s.username})`);
    try {
      s.rdp?.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    await sleep(1000);
    s.rdpFailReason = null;
    s.rdp = spawnRdp(s, ".", password);
    attachRdpPumps(s);
    const second = await settleRdp(s, 20_000);
    if (second === "nologon") {
      pushTail(
        s,
        "bridge",
        "local account was also rejected — verify the credentials in the vault"
      );
    }
  } finally {
    s.retrying = false;
  }
}

interface CreateBody {
  credentialId?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  width?: number;
  height?: number;
}

async function createSession(req: Request): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return json({ message: "Invalid JSON body" }, 400);
  }
  const host = (body.host ?? "").trim();
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const port = clampInt(body.port, 1, 65535, 3389);
  if (!host || !username || !password) {
    return json({ message: "host, username and password are required" }, 400);
  }

  const slot = nextSlot();
  if (!slot) {
    return json({ message: "Session limit reached — close an active session first" }, 429);
  }
  const width = clampInt(body.width, 800, 1920, 1280);
  const height = clampInt(body.height, 600, 1200, 800);
  const { display, vncPort } = slot;
  clearXLock(display);
  console.log(`[bridge] create: slot :${display} vnc ${vncPort}`);

  const s: BridgeSession = {
    sessionId: crypto.randomUUID(),
    credentialId: (body.credentialId ?? "").slice(0, 64),
    host,
    port,
    username,
    domain: (body.domain ?? "").trim(),
    width,
    height,
    display,
    vncPort,
    status: "launching",
    startedAt: new Date().toISOString(),
    tail: [],
    xvfb: null,
    rdp: null,
    vnc: null,
    watcher: null,
    retrying: false,
    rdpFailReason: null,
  };

  // Reserve the slot SYNCHRONOUSLY before any async work so two overlapping
  // requests (e.g. React StrictMode double-effects in dev) can never grab the
  // same display/vnc port.
  sessions.set(s.sessionId, s);

  // Hard launch budget: a wedged spawn can never hang the API (the Next.js
  // caller aborts at 30s and the operator just sees a spinning dialog).
  const LAUNCH_BUDGET_MS = 10_000;
  let launchTimedOut = false;
  const budget = setTimeout(() => {
    launchTimedOut = true;
  }, LAUNCH_BUDGET_MS);

  try {
    s.xvfb = Bun.spawn(
      [XVFB_BIN, `:${display}`, "-screen", "0", `${width}x${height}x24`, "-ac", "-nolisten", "tcp"],
      { stdout: "pipe", stderr: "pipe", env: sessionEnv(display) }
    );
    await sleep(400);
    if (launchTimedOut) throw new Error("launch budget exceeded while starting Xvfb");
    if (!alive(s.xvfb)) throw new Error("Xvfb failed to start");
    console.log(`[bridge] create: xvfb ok (:${display})`);

    s.rdp = spawnRdp(s, s.domain || null, password);
    attachRdpPumps(s);
    // Only a vault entry WITH a domain can benefit from the local fallback.
    if (s.domain && s.domain !== ".") s.retrying = true;
    console.log(`[bridge] create: rdp spawned (pid ${s.rdp.pid}, domain=${s.domain || "<none>"})`);

    await sleep(600);
    if (launchTimedOut) throw new Error("launch budget exceeded while starting VNC");
    s.vnc = Bun.spawn(
      [
        X11VNC_BIN,
        "-display",
        `:${display}`,
        "-rfbport",
        String(vncPort),
        "-localhost",
        "-nopw",
        "-shared",
        "-forever",
        "-noxdamage",
        "-nosel",
      ],
      { stdout: "pipe", stderr: "pipe", env: sessionEnv(display) }
    );
    console.log(`[bridge] create: vnc ok (:${display})`);
  } catch (err) {
    clearTimeout(budget);
    killAll(s);
    sessions.delete(s.sessionId);
    return json(
      {
        message: "Failed to launch session processes",
        detail: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
  clearTimeout(budget);

  void pump(s.vnc.stdout, s, "vnc");
  void pump(s.vnc.stderr, s, "vnc");
  if (s.xvfb) void pump(s.xvfb.stderr, s, "xvfb");
  if (s.retrying) void watchRdpFallback(s, password);
  startWatcher(s);
  return json({ session: publicSession(s) }, 201);
}

// Kill leftovers from previous runs / hot reloads so displays never stay wedged.
function killOrphans(): void {
  try {
    const res = Bun.spawnSync(["ps", "-eo", "pid,args"]);
    const text = new TextDecoder().decode(res.stdout as Uint8Array);
    for (const line of text.split("\n")) {
      const ours =
        line.includes("Xvfb :16") ||
        line.includes("xfreerdp3 /v:") ||
        (line.includes("x11vnc") && /-display :16\d/.test(line));
      if (!ours) continue;
      const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
      if (Number.isFinite(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    /* best effort */
  }
}

const server = Bun.serve<WsData>({
  port: PORT,
  hostname: HOSTNAME,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // --- WebSocket upgrade for the VNC proxy ------------------------------
    // Must be handled BEFORE the REST routes: an upgrade to "/" would
    // otherwise be swallowed by the health branch below (returns 200 JSON
    // instead of 101, so noVNC never gets the RFB banner).
    const upgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (upgrade) {
      const sessionId = url.searchParams.get("session") ?? "";
      if (!sessions.has(sessionId)) return json({ message: "Unknown session" }, 404);
      const success = srv.upgrade(req, { data: { sessionId, sock: undefined } });
      if (success) return;
      return json({ message: "WebSocket upgrade failed" }, 400);
    }

    // --- REST -------------------------------------------------------------
    if (req.method === "GET" && (path === "/" || path === "/api/health")) {
      const list = [...sessions.values()].map(publicSession);
      return json({
        ok: true,
        active: list.filter((s) => s.status === "live" || s.status === "launching").length,
        sessions: list,
      });
    }
    if (path === "/api/sessions") {
      if (req.method === "POST") return createSession(req);
      if (req.method === "GET") {
        return json({ sessions: [...sessions.values()].map(publicSession) });
      }
    }
    const m = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (req.method === "GET") {
        const s = sessions.get(id);
        return s ? json({ session: publicSession(s) }) : json({ message: "Session not found" }, 404);
      }
      if (req.method === "DELETE") {
        return json({ stopped: stopSession(id) });
      }
    }

    return json({ message: "Not found" }, 404);
  },
  websocket: {
    idleTimeout: 960, // keep idle desktops alive up to 16 minutes
    open(ws) {
      const data = ws.data as WsData;
      const s = sessions.get(data.sessionId);
      console.log(`[bridge] ws open session=${data.sessionId.slice(0, 8)} found=${!!s}`);
      if (!s) {
        try {
          ws.close(1008, "unknown session");
        } catch {
          /* ignore */
        }
        return;
      }
      // x11vnc may still be binding its port when the viewer arrives — retry
      // the TCP connect for up to ~20s instead of failing the session.
      const connectWithRetry = (attempt: number): void => {
        if (data.closed) return;
        Bun.connect({
          hostname: "127.0.0.1",
          port: s.vncPort,
          socket: {
            data(_ctx, chunk) {
              try {
                ws.send(chunk as Uint8Array);
              } catch {
                /* ignore */
              }
            },
            close() {
              console.log(`[bridge] vnc tcp closed for ${data.sessionId.slice(0, 8)}`);
              try {
                ws.close(1000, "vnc closed");
              } catch {
                /* ignore */
              }
            },
            error() {
              console.log(`[bridge] vnc tcp error for ${data.sessionId.slice(0, 8)}`);
              try {
                ws.close(1011, "vnc error");
              } catch {
                /* ignore */
              }
            },
          },
        })
          .then((sock) => {
            console.log(
              `[bridge] vnc tcp connected for ${data.sessionId.slice(0, 8)} (attempt ${attempt})`
            );
            data.sock = sock;
          })
          .catch(() => {
            if (data.closed) return;
            if (attempt < 40) {
              setTimeout(() => connectWithRetry(attempt + 1), 500);
            } else {
              console.log(`[bridge] vnc tcp CONNECT FAILED for ${data.sessionId.slice(0, 8)}`);
              try {
                ws.close(1011, "vnc connect failed");
              } catch {
                /* ignore */
              }
            }
          });
      };
      connectWithRetry(0);
    },
    message(ws, message) {
      const data = ws.data as WsData;
      if (data.sock) {
        try {
          data.sock.write(message as Uint8Array);
        } catch {
          /* ignore */
        }
      }
    },
    close(ws) {
      const data = ws.data as WsData;
      console.log(`[bridge] ws close session=${(data?.sessionId ?? "?").slice(0, 8)}`);
      if (data) data.closed = true;
      if (data?.sock) {
        try {
          data.sock.end();
        } catch {
          /* ignore */
        }
        data.sock = undefined;
      }
    },
  },
});

killOrphans();

// Never let a stray stream/reload panic wedge the service again: log and keep
// serving (the ERR_STREAM_RELEASE_LOCK AbortError previously killed the loop
// mid-createSession, leaving sessions stuck in "launching" and 502s upstream).
process.on("uncaughtException", (err) => {
  console.error("[bridge] uncaught exception (service kept alive):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[bridge] unhandled rejection (service kept alive):", err);
});

// Reap expired records; kill sessions stuck in "launching".
setInterval(() => {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    const age = now - new Date(s.startedAt).getTime();
    if (s.status === "launching" && age > 90_000) {
      s.status = "error";
      s.tail.push("[bridge] launch timeout");
      killAll(s);
      if (s.watcher) clearInterval(s.watcher);
    }
    if ((s.status === "error" || s.status === "closed") && age > 10 * 60_000) {
      sessions.delete(s.sessionId);
    }
  }
}, 30_000);

console.log(`[rdp-bridge] listening on ${HOSTNAME}:${PORT} (server id: ${server.id})`);
