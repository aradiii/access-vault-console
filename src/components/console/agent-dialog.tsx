"use client";

import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Activity,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  FileJson,
  KeyRound,
  MemoryStick,
  RefreshCcw,
  SatelliteDish,
  Timer,
  TriangleAlert,
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
import { ConfirmDialog } from "./confirm-dialog";
import { copyToClipboard, downloadTextFile } from "@/lib/clipboard";
import { agentIsFresh, uptimeLabel, useConsoleStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CredentialDTO } from "@/lib/console-types";

export function AgentDialog() {
  const open = useConsoleStore((s) => s.agentDialogOpen);
  const agentId = useConsoleStore((s) => s.agentCredentialId);
  const credentials = useConsoleStore((s) => s.credentials);
  const setAgentDialogOpen = useConsoleStore((s) => s.setAgentDialogOpen);

  const cred = React.useMemo(
    () => credentials.find((c) => c.id === agentId) ?? null,
    [credentials, agentId]
  );

  return (
    <Dialog open={open} onOpenChange={setAgentDialogOpen}>
      {open && cred && (
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" aria-describedby={undefined}>
          <AgentSetup key={cred.id} cred={cred} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function AgentSetup({ cred }: { cred: CredentialDTO }) {
  const fetchCredentials = useConsoleStore((s) => s.fetchCredentials);

  const [token, setToken] = React.useState<string>(cred.agentToken ?? "");
  const [issuing, setIssuing] = React.useState(false);
  const [confirmRotate, setConfirmRotate] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const fresh = agentIsFresh(cred);
  const hasTelemetry = cred.lastAgentReportAt != null;

  // Lazily issue a token the first time the dialog is opened for this server.
  const issueToken = React.useCallback(
    async (rotate: boolean) => {
      if (issuing) return;
      setIssuing(true);
      try {
        const res = await fetch("/api/rdp/agent/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentialId: cred.id, rotate }),
        });
        const data = (await res.json()) as { token?: string; message?: string };
        if (!res.ok || !data.token) throw new Error(data.message || `HTTP ${res.status}`);
        setToken(data.token);
        await fetchCredentials(true);
        toast.success(rotate ? "Agent token rotated." : "Agent token issued.");
      } catch (err) {
        toast.error("Token issue failed: " + (err instanceof Error ? err.message : "unknown"));
      } finally {
        setIssuing(false);
      }
    },
    [cred.id, fetchCredentials, issuing]
  );

  React.useEffect(() => {
    if (cred.agentToken) return;
    // deferred so the token POST is not fired synchronously inside the effect
    const t = setTimeout(() => void issueToken(false), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cred.agentToken]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const configJson = React.useMemo(
    () => JSON.stringify({ serverUrl: origin || "PASTE-CONSOLE-URL-HERE", token, intervalSec: 30 }, null, 2),
    [origin, token]
  );

  const oneLiner = React.useMemo(() => {
    return (
      `$u='${origin}'; $t='${token}'; ` +
      `irm "$u/agent/agent.ps1" -OutFile "$env:TEMP\\av-agent.ps1"; ` +
      `@{serverUrl=$u; token=$t; intervalSec=30} | ConvertTo-Json | Set-Content "$env:TEMP\\av-config.json"; ` +
      `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\av-agent.ps1" -ConfigFile "$env:TEMP\\av-config.json"`
    );
  }, [origin, token]);

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success(`${label} copied.`);
    else toast.error("Clipboard copy failed.");
  };

  const handleDownloadScript = async () => {
    setBusy(true);
    try {
      const res = await fetch("/agent/agent.ps1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      downloadTextFile("agent.ps1", text, "application/powershell");
      toast.success("agent.ps1 downloaded.");
    } catch (err) {
      toast.error("Download failed: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadConfig = () => {
    downloadTextFile("config.json", configJson, "application/json");
    toast.success("config.json downloaded.");
  };

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base">
          <SatelliteDish className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Monitor Agent — {cred.host}:{cred.port}
        </DialogTitle>
        <DialogDescription>
          Runs inside the Windows server and self-reports its real specs (CPU, RAM, Windows
          edition) plus live CPU / memory / uptime telemetry — no firewall changes needed.
        </DialogDescription>
      </DialogHeader>

      {/* Live status */}
      <section aria-label="Agent telemetry" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span
            className={cn(
              "flex items-center gap-1.5 font-semibold",
              fresh
                ? "text-emerald-600 dark:text-emerald-400"
                : hasTelemetry
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
            )}
          >
            {fresh ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {fresh ? "Reporting live" : hasTelemetry ? "Stale — last report below" : "Not reporting yet"}
          </span>
          {cred.lastAgentReportAt && (
            <span className="text-muted-foreground">
              last report {formatDistanceToNowStrict(new Date(cred.lastAgentReportAt), { addSuffix: true })}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MetricCard
            icon={<Cpu className="h-3.5 w-3.5" aria-hidden="true" />}
            label="CPU Load"
            value={cred.cpuLoad != null ? `${cred.cpuLoad}%` : "--"}
            accent={fresh}
          />
          <MetricCard
            icon={<MemoryStick className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Memory"
            value={cred.memUsedPercent != null ? `${cred.memUsedPercent}%` : "--"}
            accent={fresh}
          />
          <MetricCard
            icon={<Timer className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Uptime"
            value={uptimeLabel(cred.uptimeSec)}
            accent={fresh}
          />
        </div>

        {(cred.osName || cred.computerName) && (
          <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Self-reported identity:{" "}
            <span className="font-medium text-foreground">
              {[cred.computerName, cred.osName].filter(Boolean).join(" · ")}
            </span>
          </p>
        )}
      </section>

      {/* Token */}
      <section aria-label="Agent token" className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Token
        </h3>
        <div className="flex items-center gap-2">
          <code
            className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted/50 px-2.5 py-2 font-mono text-[11px] whitespace-nowrap"
            data-testid="agent-token"
          >
            {token || (issuing ? "issuing…" : "—")}
          </code>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => void handleCopy(token, "Token")}
            disabled={!token}
            aria-label="Copy agent token"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setConfirmRotate(true)}
            disabled={!token || issuing}
            aria-label="Rotate agent token"
            title="Invalidate and reissue the token"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </section>

      {/* Setup steps */}
      <section aria-label="Setup steps" className="flex flex-col gap-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Deploy on the server
        </h3>

        <ol className="flex flex-col gap-2 text-xs">
          <li className="rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span>
                <strong>1.</strong> Download the agent + its config (token pre-filled):
              </span>
              <span className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void handleDownloadScript()} disabled={busy}>
                  <Download className="h-3 w-3" /> agent.ps1
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={handleDownloadConfig} disabled={!token}>
                  <FileJson className="h-3 w-3" /> config.json
                </Button>
              </span>
            </div>
          </li>
          <li className="rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span>
                <strong>2.</strong> Run on the server:{" "}
                <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]">
                  powershell -ExecutionPolicy Bypass -File .\agent.ps1
                </code>
              </span>
            </div>
          </li>
          <li className="rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span>
                <strong>Or:</strong> copy this one-liner and paste it into the server&apos;s
                PowerShell (downloads, configures and starts reporting):
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => void handleCopy(oneLiner, "One-liner")}
                disabled={!token}
              >
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
          </li>
          <li className="rounded-md border border-border p-2.5 text-muted-foreground">
            <strong className="text-foreground">3.</strong> Keep it running after reboots (as
            Administrator, once):{" "}
            <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]">
              .\agent.ps1 -Install
            </code>{" "}
            — registers a scheduled task that starts the agent at boot.
          </li>
        </ol>
      </section>

      <div className="flex items-start gap-1.5 rounded-md bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <Activity className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        The agent reports over HTTPS every 30 seconds. Reports fill in the server&apos;s specs and
        Windows edition automatically, but do not interfere with TCP reachability probes. Rotate
        the token if it ever leaks — the running agent must then be reconfigured.
      </div>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Rotate agent token?"
        description={
          <>
            The current token for <strong>{cred.host}:{cred.port}</strong> will be invalidated. Any
            agent still using it will stop reporting until reconfigured with the new token.
          </>
        }
        confirmLabel="Rotate Token"
        onConfirm={() => {
          setConfirmRotate(false);
          void issueToken(true);
        }}
      />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border p-2.5 text-center",
        accent && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-sm font-bold tabular-nums",
          accent ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
        )}
        data-testid={`agent-metric-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {value}
      </div>
    </div>
  );
}
