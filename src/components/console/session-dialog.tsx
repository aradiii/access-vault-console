"use client";

import * as React from "react";
import {
  Camera,
  ChevronDown,
  ClipboardPaste,
  ClipboardType,
  Command,
  Copy,
  Keyboard,
  Loader2,
  LogIn,
  LogOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  ShieldAlert,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useConsoleStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type RfbLike = {
  scaleViewport: boolean;
  background: string;
  focus(options?: FocusOptions): void;
  blur?(): void;
  sendCtrlAltDel(): void;
  /** noVNC sendKey — keysym is an X11 keysym number, code is optional. */
  sendKey(keysym: number, code?: string | null, down?: boolean): void;
  clipboardPasteFrom(text: string): void;
  disconnect(): void;
  addEventListener(type: string, listener: (ev: CustomEvent) => void): void;
  removeEventListener(type: string, listener: (ev: CustomEvent) => void): void;
};

interface SessionInfo {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  domain: string;
  status: "launching" | "live" | "error" | "closed";
  tail?: string[];
}

type Phase = "launching" | "connecting" | "live" | "error" | "closed";
type ToolPanel = "keys" | "text" | null;

const BRIDGE_PORT = 3010;

// X11 keysyms used by the "send keys" tools.
const K = {
  ctrl: 0xffe3,
  shift: 0xffe1,
  alt: 0xffe9,
  win: 0xffeb, // Super_L
  tab: 0xff09,
  esc: 0xff1b,
  enter: 0xff0d,
  del: 0xffff,
  r: 0x72,
  e: 0x65,
  l: 0x6c,
} as const;

interface KeyTool {
  id: string;
  label: string;
  hint: string;
  keys: number[];
}

const KEY_TOOLS: KeyTool[] = [
  { id: "cad", label: "Ctrl+Alt+Del", hint: "Logon / security", keys: [K.ctrl, K.alt, K.del] },
  { id: "taskmgr", label: "Task Manager", hint: "Ctrl+Shift+Esc", keys: [K.ctrl, K.shift, K.esc] },
  { id: "start", label: "Start menu", hint: "Win", keys: [K.win] },
  { id: "run", label: "Run dialog", hint: "Win+R", keys: [K.win, K.r] },
  { id: "explorer", label: "File Explorer", hint: "Win+E", keys: [K.win, K.e] },
  { id: "lock", label: "Lock screen", hint: "Win+L", keys: [K.win, K.l] },
  { id: "alttab", label: "Switch window", hint: "Alt+Tab", keys: [K.alt, K.tab] },
  { id: "esc", label: "Escape", hint: "Esc", keys: [K.esc] },
];

/** Sends a chord: all keys down, then up in reverse order. */
function sendCombo(rfb: RfbLike, keys: number[]): void {
  for (const k of keys) {
    try {
      rfb.sendKey(k, null, true);
    } catch {
      /* ignore */
    }
  }
  for (const k of [...keys].reverse()) {
    try {
      rfb.sendKey(k, null, false);
    } catch {
      /* ignore */
    }
  }
}

/** Types printable ASCII (+Enter/Tab) as real key presses into the session. */
async function typeAscii(rfb: RfbLike, text: string): Promise<void> {
  for (const ch of text) {
    let keysym: number | null = null;
    if (ch === "\n") keysym = K.enter;
    else if (ch === "\t") keysym = K.tab;
    else {
      const c = ch.charCodeAt(0);
      if (c >= 0x20 && c <= 0x7e) keysym = c;
    }
    if (keysym === null) continue;
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
    await new Promise((r) => setTimeout(r, 6)); // gentle cadence for x11vnc
  }
}

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Translates raw xfreerdp/bridge log signatures into an actionable hint. */
function friendlySessionError(lines: string[]): string | null {
  const all = lines.join("\n");
  if (/NO_LOGON_SERVERS/i.test(all)) {
    return "The server could not reach a domain controller to validate this account. The console already retried it as a local login (\\\\username) — if it still failed, the credentials in the vault are wrong for this server.";
  }
  if (/STATUS_LOGON_FAILURE|ERRCONNECT_AUTHENTICATION_FAILED|LOGON_FAILED/i.test(all)) {
    return "The server rejected the username or password — correct the entry in the Access Vault and try again.";
  }
  if (
    /ERRCONNECT_CONNECT_FAILED|ERRCONNECT_DNS_NAME_NOT_FOUND|ERRCONNECT_PEER_CLOSED|ERRCONNECT_TIMEOUT/i.test(
      all
    )
  ) {
    return "The server was unreachable on that host:port — make sure the VM is running and RDP port 3389 accepts connections.";
  }
  if (/account.*(locked|disabled)|STATUS_ACCOUNT_LOCKED_OUT|STATUS_ACCOUNT_DISABLED/i.test(all)) {
    return "The account is locked or disabled on the server — unlock it and retry.";
  }
  if (/launch budget|Failed to launch/i.test(all)) {
    return "The session bridge could not start the connection processes — try again in a few seconds.";
  }
  return null;
}

export function SessionDialog() {
  const open = useConsoleStore((s) => s.sessionDialogOpen);
  const credentialId = useConsoleStore((s) => s.sessionCredentialId);
  const setSessionDialogOpen = useConsoleStore((s) => s.setSessionDialogOpen);

  return (
    <Dialog open={open} onOpenChange={setSessionDialogOpen}>
      {/* key remounts the viewer whenever a new login starts, so phase/error
          state resets naturally (same pattern as CredentialDialog) */}
      {open && credentialId && (
        <DialogContent
          hideClose
          onEscapeKeyDown={(e) => {
            // While the viewer is fullscreen, Esc should only leave fullscreen —
            // not tear down the whole session dialog.
            if (document.fullscreenElement) e.preventDefault();
          }}
          className="flex h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0"
        >
          <SessionViewer key={credentialId} credentialId={credentialId} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function SessionViewer({ credentialId }: { credentialId: string }) {
  const setSessionDialogOpen = useConsoleStore((s) => s.setSessionDialogOpen);

  const [phase, setPhase] = React.useState<Phase>("launching");
  const [errorLines, setErrorLines] = React.useState<string[]>([]);
  const [desktopName, setDesktopName] = React.useState("");
  const [meta, setMeta] = React.useState<SessionInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  /** Bumped by "Try again" — re-runs the whole launch effect. */
  const [runId, setRunId] = React.useState(0);
  const [panel, setPanel] = React.useState<ToolPanel>(null);
  const [remoteClip, setRemoteClip] = React.useState("");
  const [typeBuffer, setTypeBuffer] = React.useState("");
  const [busy, setBusy] = React.useState<"type" | null>(null);
  const [liveSince, setLiveSince] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const rfbMountRef = React.useRef<HTMLDivElement | null>(null);
  const rfbRef = React.useRef<RfbLike | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSessionRequest = React.useCallback(async () => {
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
    }
    if (id) {
      try {
        await fetch(`/api/rdp/sessions/${encodeURIComponent(id)}`, {
          method: "DELETE",
          keepalive: true,
        });
      } catch {
        /* best effort */
      }
    }
  }, []);

  /** Deletes a session id WITHOUT touching shared refs — used by superseded
   * effect chains (React StrictMode double-mount) so they can never kill the
   * live connection owned by the current chain. */
  const discardSession = React.useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      await fetch(`/api/rdp/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        keepalive: true,
      });
    } catch {
      /* best effort */
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/rdp/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentialId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          session?: SessionInfo;
          message?: string;
        };
        if (!res.ok || !data.session) {
          throw new Error(data.message ?? `HTTP ${res.status}`);
        }
        if (cancelled) {
          // Superseded chain: delete OUR session, never touch shared refs —
          // the current chain may already own a live RFB connection.
          void discardSession(data.session.sessionId);
          return;
        }
        const session = data.session;
        sessionIdRef.current = session.sessionId;
        setMeta(session);

        pollRef.current = setInterval(async () => {
          const id = sessionIdRef.current;
          if (!id) return;
          try {
            const r = await fetch(`/api/rdp/sessions/${encodeURIComponent(id)}`);
            if (!r.ok) return;
            const body = (await r.json()) as { session?: SessionInfo };
            if (body.session?.status === "error") {
              setErrorLines(body.session.tail ?? []);
              setPhase("error");
              setLiveSince(null);
              setPanel(null);
            }
          } catch {
            /* transient polling errors are non-fatal */
          }
        }, 2500);

        setPhase("connecting");
        const { default: RFB } = await import("@novnc/novnc");
        if (cancelled || !rfbMountRef.current) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}/?XTransformPort=${BRIDGE_PORT}&session=${encodeURIComponent(session.sessionId)}`;

        const rfb = new RFB(rfbMountRef.current, wsUrl, { shared: true });
        rfb.scaleViewport = true;
        rfb.background = "#000000";
        rfbRef.current = rfb;

        rfb.addEventListener("connect", () => {
          if (cancelled) return;
          setPhase("live");
          setLiveSince(Date.now());
          setNow(Date.now());
          toast.success(`Live session established with ${session.host}`);
          try {
            rfb.focus({ preventScroll: true });
          } catch {
            /* ignore */
          }
        });
        rfb.addEventListener("desktopname", (e) => {
          const name = (e as CustomEvent).detail?.name;
          if (name) setDesktopName(String(name));
        });
        rfb.addEventListener("clipboard", (e) => {
          if (cancelled) return;
          const text = (e as CustomEvent).detail?.text;
          if (typeof text === "string") setRemoteClip(text);
        });
        rfb.addEventListener("securityfailure", (e) => {
          if (cancelled) return;
          const detail = (e as CustomEvent).detail;
          const reason = detail?.reason ?? "authentication/security failure";
          setErrorLines([`Security failure: ${reason}`]);
          setPhase("error");
          setLiveSince(null);
          setPanel(null);
        });
        rfb.addEventListener("disconnect", (e) => {
          if (cancelled) return;
          const clean = !!(e as CustomEvent).detail?.clean;
          if (!clean) {
            setErrorLines((prev) =>
              prev.length ? prev : ["Connection to the remote session was lost."]
            );
            setPhase("error");
            setLiveSince(null);
            setPanel(null);
          }
        });
      } catch (err) {
        if (cancelled) return;
        setErrorLines([err instanceof Error ? err.message : "Failed to launch session"]);
        setPhase("error");
        void stopSessionRequest();
      }
    })();

    return () => {
      cancelled = true;
      void stopSessionRequest();
    };
  }, [credentialId, runId, stopSessionRequest, discardSession]);

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Uptime ticker — only while live.
  React.useEffect(() => {
    if (phase !== "live" || !liveSince) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [phase, liveSince]);

  const closePanel = React.useCallback(() => {
    setPanel(null);
    // Hand keyboard capture back to the remote desktop.
    try {
      rfbRef.current?.focus?.({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }, []);

  // Close any open tool panel with Escape (while not in fullscreen, where the
  // browser consumes Esc first — the backdrop click covers that case).
  React.useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        e.stopPropagation();
        closePanel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [panel, closePanel]);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      containerRef.current?.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  /** Stops the bridge session, leaves fullscreen and closes the dialog. */
  const handleDisconnect = React.useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    void stopSessionRequest();
    setSessionDialogOpen(false);
  }, [stopSessionRequest, setSessionDialogOpen]);

  const retry = React.useCallback(() => {
    setPanel(null);
    setErrorLines([]);
    setDesktopName("");
    setRemoteClip("");
    setLiveSince(null);
    setPhase("launching");
    setRunId((n) => n + 1);
  }, []);

  const liveRfb = (): RfbLike | null => {
    if (phase !== "live" || !rfbRef.current) return null;
    return rfbRef.current;
  };

  const sendKeys = React.useCallback(
    (keys: number[]) => {
      const rfb = liveRfb();
      if (!rfb) return;
      sendCombo(rfb, keys);
      closePanel();
      toast.success("Key combo sent to the session");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, closePanel]
  );

  const doType = React.useCallback(async () => {
    const rfb = liveRfb();
    if (!rfb || !typeBuffer) return;
    setBusy("type");
    try {
      await typeAscii(rfb, typeBuffer);
      toast.success(`Typed ${typeBuffer.length} characters into the session`);
      setTypeBuffer("");
    } catch {
      toast.error("Could not type into the session");
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, typeBuffer]);

  const clipPull = React.useCallback(async () => {
    if (!remoteClip) return;
    try {
      await navigator.clipboard.writeText(remoteClip);
      toast.success("Remote clipboard copied to your device");
    } catch {
      toast.error("Browser blocked clipboard access — select and copy it manually");
    }
  }, [remoteClip]);

  const clipPush = React.useCallback(async () => {
    const rfb = liveRfb();
    if (!rfb) return;
    let text = typeBuffer;
    if (!text) {
      try {
        text = await navigator.clipboard.readText();
      } catch {
        toast.error("Type text above or allow clipboard access");
        return;
      }
    }
    if (!text) {
      toast.error("Nothing to send — type text first");
      return;
    }
    try {
      rfb.clipboardPasteFrom(text);
      toast.success("Sent to the remote clipboard (Ctrl+V on the server)");
    } catch {
      toast.error("Could not send the clipboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, typeBuffer]);

  const screenshot = React.useCallback(() => {
    const canvas = rfbMountRef.current?.querySelector("canvas");
    if (!canvas) {
      toast.error("No frame available yet");
      return;
    }
    try {
      (canvas as HTMLCanvasElement).toBlob((blob) => {
        if (!blob) {
          toast.error("Screenshot failed");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        a.href = url;
        a.download = `rdp-${meta?.host ?? "session"}-${stamp}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast.success("Screenshot downloaded");
      }, "image/png");
    } catch {
      toast.error("Screenshot failed");
    }
  }, [meta?.host]);

  const live = phase === "live";

  return (
    <>
      <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b border-border px-4 py-3 text-left">
        <div className="min-w-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <LogIn className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">
              Live RDP Session — {meta ? `${meta.host}:${meta.port}` : "launching"}
            </span>
          </DialogTitle>
          <DialogDescription className="truncate text-xs">
            {meta
              ? `${meta.domain ? `${meta.domain}\\` : ""}${meta.username}`
              : "preparing the session bridge"}
            {desktopName ? ` · ${desktopName}` : ""}
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill phase={phase} />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:text-destructive"
            onClick={handleDisconnect}
            aria-label="Disconnect and close"
            title="Disconnect and close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </DialogHeader>

      <div className="relative min-h-0 flex-1 bg-black" aria-label="Remote desktop viewer">
        <div ref={containerRef} className="absolute inset-0">
          <div ref={rfbMountRef} className="absolute inset-0" />

          {/* Dim backdrop while a tool panel is open (below the toolbar so the
              toolbar itself stays clickable). */}
          {panel && (
            <button
              type="button"
              aria-label="Close tool panel"
              onClick={closePanel}
              className="absolute inset-0 z-20 cursor-default bg-black/40"
              tabIndex={-1}
            />
          )}

          {/* Floating session toolbar — lives INSIDE the fullscreen container so
              every control stays reachable while the desktop fills the screen. */}
          <div className="absolute right-3 top-3 z-30 flex flex-col items-end">
            <div
              role="toolbar"
              aria-label="Session controls"
              className="flex items-center gap-1 rounded-full border border-white/10 bg-black/80 p-1 shadow-xl backdrop-blur-sm"
            >
              <span className="hidden items-center gap-1.5 pl-2 pr-1 text-[11px] font-medium text-white/60 sm:flex">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    live ? "bg-emerald-400" : phase === "error" ? "bg-red-400" : "animate-pulse bg-amber-400"
                  )}
                  aria-hidden="true"
                />
                <span className="max-w-[140px] truncate">
                  {meta ? `${meta.host}:${meta.port}` : "…"}
                </span>
              </span>

              {live && liveSince && (
                <span
                  className="hidden items-center gap-1 rounded-full bg-white/5 px-2 py-1 font-mono text-[11px] tabular-nums text-white/60 md:flex"
                  title="Session uptime"
                >
                  <Timer className="h-3 w-3" aria-hidden="true" />
                  {fmtUptime(now - liveSince)}
                </span>
              )}

              {live && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 rounded-full px-2.5 text-[11px] text-white/75 hover:bg-white/10 hover:text-white"
                  onClick={() => rfbRef.current?.sendCtrlAltDel()}
                  title="Ctrl+Alt+Del — Windows logon / security screen"
                >
                  <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden md:inline">Ctrl+Alt+Del</span>
                </Button>
              )}

              {live && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={panel === "keys"}
                    aria-haspopup="true"
                    className={cn(
                      "h-8 gap-1.5 rounded-full px-2.5 text-[11px] text-white/75 hover:bg-white/10 hover:text-white",
                      panel === "keys" && "bg-white/10 text-white"
                    )}
                    onClick={() => setPanel(panel === "keys" ? null : "keys")}
                    title="Send key combos to the session"
                  >
                    <Command className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Keys</span>
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={panel === "text"}
                    aria-haspopup="true"
                    className={cn(
                      "h-8 gap-1.5 rounded-full px-2.5 text-[11px] text-white/75 hover:bg-white/10 hover:text-white",
                      panel === "text" && "bg-white/10 text-white"
                    )}
                    onClick={() => setPanel(panel === "text" ? null : "text")}
                    title="Type text & sync clipboard"
                  >
                    <ClipboardType className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Text</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-white/75 hover:bg-white/10 hover:text-white"
                    onClick={screenshot}
                    aria-label="Download screenshot"
                    title="Download screenshot (PNG)"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                </>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-white/75 hover:bg-white/10 hover:text-white"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-2.5 text-[11px] text-red-300 hover:bg-red-500/20 hover:text-red-200"
                onClick={handleDisconnect}
                aria-label="Disconnect and go back"
                title="Disconnect and go back"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Disconnect</span>
              </Button>
            </div>

            {/* ---- Keys panel ---- */}
            {panel === "keys" && (
              <div className="mt-2 w-64 rounded-lg border border-border bg-card p-2 text-card-foreground shadow-2xl">
                <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Send keys — delivered as real presses
                </p>
                <div className="max-h-72 overflow-y-auto scrollbar-thin">
                  {KEY_TOOLS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => sendKeys(t.keys)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <span className="font-medium">{t.label}</span>
                      <span className="text-[10px] text-muted-foreground">{t.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Text & clipboard panel ---- */}
            {panel === "text" && (
              <div className="mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 text-card-foreground shadow-2xl">
                <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Type into session
                </p>
                <Textarea
                  value={typeBuffer}
                  onChange={(e) => setTypeBuffer(e.target.value)}
                  rows={3}
                  placeholder="Commands or text to type on the server…"
                  className="resize-none bg-muted/30 font-mono text-xs"
                  aria-label="Text to type into the remote session"
                />
                <div className="flex items-center justify-between gap-2 pt-2">
                  <span className="text-[10px] text-muted-foreground">
                    {typeBuffer.length} chars · ASCII · Enter = ↵
                  </span>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    disabled={!typeBuffer || busy === "type" || !live}
                    onClick={() => void doType()}
                  >
                    {busy === "type" ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <Keyboard className="h-3 w-3" aria-hidden="true" />
                    )}
                    Type
                  </Button>
                </div>

                <div className="my-3 border-t border-border" />

                <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Remote clipboard
                </p>
                <div className="scrollbar-thin max-h-20 min-h-10 overflow-y-auto break-all rounded-md bg-muted/30 p-2 font-mono text-[11px] text-muted-foreground">
                  {remoteClip || "Nothing received from the session yet"}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    disabled={!remoteClip}
                    onClick={() => void clipPull()}
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    Copy to my device
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    disabled={!live}
                    onClick={() => void clipPush()}
                  >
                    <ClipboardPaste className="h-3 w-3" aria-hidden="true" />
                    Send to server
                  </Button>
                </div>
                <p className="pt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  “Send to server” uses the text box, or your local clipboard when it is
                  empty. Then press Ctrl+V on the server.
                </p>
              </div>
            )}
          </div>
        </div>

        {phase !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {phase === "error" ? (
              <>
                <ShieldAlert className="h-10 w-10 text-red-500" aria-hidden="true" />
                <p className="text-sm font-semibold text-red-400">
                  Session could not be established
                </p>
                {friendlySessionError(errorLines) && (
                  <p className="max-w-xl rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-left text-xs leading-relaxed text-amber-300">
                    {friendlySessionError(errorLines)}
                  </p>
                )}
                <pre className="scrollbar-thin max-h-40 max-w-xl overflow-auto whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/5 p-3 text-left font-mono text-[11px] leading-relaxed text-red-300">
                  {errorLines.slice(-10).join("\n") || "Unknown error"}
                </pre>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" className="h-8 gap-1.5" onClick={retry}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Try again
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 border-white/20 bg-transparent text-white/80 hover:bg-white/10 hover:text-white"
                    onClick={handleDisconnect}
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Back to console
                  </Button>
                </div>
                <p className="max-w-md text-xs text-muted-foreground">
                  Verify the credentials in the Access Vault and that the server accepts RDP
                  logins — then retry without leaving this window.
                </p>
              </>
            ) : (
              <>
                <Loader2
                  className="h-10 w-10 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold">
                  {phase === "launching"
                    ? "Logging in to the server…"
                    : "Negotiating the RDP connection…"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {meta
                    ? `${meta.host}:${meta.port} · ${meta.domain ? `${meta.domain}\\` : ""}${meta.username}`
                    : "contacting the session bridge"}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span>
          Click the screen to capture keyboard &amp; mouse · Keys / Text / Screenshot live in
          the floating toolbar · Esc leaves fullscreen
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <LogOut className="h-3 w-3" aria-hidden="true" />
          Disconnect any time from the floating toolbar
        </span>
      </div>
    </>
  );
}

function StatusPill({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; cls: string }> = {
    launching: { label: "Launching", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
    connecting: { label: "Connecting", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
    live: { label: "Live", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
    error: { label: "Failed", cls: "bg-red-500/10 text-red-700 dark:text-red-400" },
    closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
  };
  const s = map[phase];
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        s.cls
      )}
    >
      {s.label}
    </span>
  );
}
