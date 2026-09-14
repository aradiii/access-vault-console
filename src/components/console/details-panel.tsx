"use client";

import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Activity, Cpu, KeyRound, LogIn, MemoryStick, Pencil, Radar, RefreshCw, SatelliteDish, Trash2, X } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { agentIsFresh, credentialSpecsLabel, uptimeLabel, useConsoleStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import { ConfirmDialog } from "./confirm-dialog";

export function DetailsPanel() {
  const selectedId = useConsoleStore((s) => s.selectedId);
  const credentials = useConsoleStore((s) => s.credentials);
  const historyCache = useConsoleStore((s) => s.historyCache);
  const selectServer = useConsoleStore((s) => s.selectServer);
  const loadHistory = useConsoleStore((s) => s.loadHistory);
  const probeSingle = useConsoleStore((s) => s.probeSingle);
  const deleteCredential = useConsoleStore((s) => s.deleteCredential);
  const setCredDialogOpen = useConsoleStore((s) => s.setCredDialogOpen);
  const setSessionDialogOpen = useConsoleStore((s) => s.setSessionDialogOpen);
  const setAgentDialogOpen = useConsoleStore((s) => s.setAgentDialogOpen);
  const checkingIds = useConsoleStore((s) => s.checkingIds);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const cred = credentials.find((c) => c.id === selectedId) ?? null;
  const records = selectedId ? historyCache[selectedId] ?? [] : [];

  React.useEffect(() => {
    if (selectedId && !(selectedId in historyCache)) {
      void loadHistory(selectedId, false);
    }
  }, [selectedId, historyCache, loadHistory]);

  if (!cred) return null;

  const chartData = [...records]
    .reverse()
    .map((r) => ({
      time: new Date(r.timestamp).toISOString().slice(11, 19),
      latency: r.latency ?? 0,
      offline: r.status === "offline",
    }));

  const checking = !!checkingIds[cred.id];
  const specs = credentialSpecsLabel(cred);

  return (
    <aside
      className="rounded-xl border border-border bg-card shadow-sm"
      aria-label={`Details for ${cred.host}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold">{cred.domain}</h2>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {cred.host}:{cred.port}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => selectServer(null)}
          aria-label="Close details panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Identity rows */}
        <dl className="flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusBadge status={cred.status} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Latency</dt>
            <dd className="font-mono tabular-nums">
              {cred.latency != null ? `${cred.latency} ms` : "unreachable"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Account</dt>
            <dd className="truncate font-mono" title={`${cred.domain}\\${cred.username}`}>
              {cred.domain}\{cred.username}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Windows</dt>
            <dd className="truncate font-mono" title={cred.osVersion ?? undefined}>
              {cred.osVersion
                ? `${cred.osName ?? "Windows"} (${cred.osVersion})`
                : "not detected"}
            </dd>
          </div>
          {cred.computerName && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Computer Name</dt>
              <dd className="truncate font-mono" title={cred.computerName}>
                {cred.computerName}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1 text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" /> Specs
            </dt>
            <dd className="font-mono">
              {specs || (
                <button
                  type="button"
                  className="underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                  onClick={() => setCredDialogOpen(true, cred.id)}
                >
                  not set — edit
                </button>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Last Checked</dt>
            <dd>
              {cred.lastChecked
                ? formatDistanceToNowStrict(new Date(cred.lastChecked), { addSuffix: true })
                : "never"}
            </dd>
          </div>
          {cred.lastAgentReportAt && (
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Agent Report
              </dt>
              <dd className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    agentIsFresh(cred) ? "bg-emerald-500" : "bg-amber-500"
                  )}
                  aria-hidden="true"
                />
                {formatDistanceToNowStrict(new Date(cred.lastAgentReportAt), { addSuffix: true })}
              </dd>
            </div>
          )}
          {cred.cpuLoad != null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">CPU / Memory</dt>
              <dd className="font-mono tabular-nums">
                {cred.cpuLoad}% / {cred.memUsedPercent != null ? `${cred.memUsedPercent}%` : "--"}
              </dd>
            </div>
          )}
          {cred.uptimeSec != null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <MemoryStick className="h-3.5 w-3.5" aria-hidden="true" /> Uptime
              </dt>
              <dd className="font-mono tabular-nums">{uptimeLabel(cred.uptimeSec)}</dd>
            </div>
          )}
          {cred.notes && (
            <div className="rounded-md bg-muted/60 p-2 leading-relaxed text-muted-foreground">
              {cred.notes}
            </div>
          )}
        </dl>

        {/* Latency trend */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Latency Trend (last {chartData.length})
          </h3>
          {chartData.length < 2 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Run more probes to build a latency trend.
            </p>
          ) : (
            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" unit="ms" width={52} />
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 11,
                      color: "var(--popover-foreground)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="latency"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Recent history */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Probe History
          </h3>
          <ul className="scrollbar-thin flex max-h-[180px] flex-col gap-1.5 overflow-y-auto pr-1 text-xs">
            {records.length === 0 ? (
              <li className="text-muted-foreground">No probe records yet.</li>
            ) : (
              records.slice(0, 12).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
                >
                  <span className="truncate text-muted-foreground">
                    {new Date(r.timestamp).toISOString().slice(11, 19)} UTC
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          r.status === "online"
                            ? "bg-emerald-500"
                            : r.status === "degraded"
                              ? "bg-amber-500"
                              : "bg-red-500"
                        )}
                        aria-hidden="true"
                      />
                      {r.status}
                    </span>
                    <span className="w-14 text-right font-mono tabular-nums text-muted-foreground">
                      {r.latency != null ? `${r.latency}ms` : "--"}
                    </span>
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            className="w-full"
            onClick={() => setSessionDialogOpen(true, cred.id)}
          >
            <LogIn className="h-4 w-4" />
            Open Live RDP Session
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => setAgentDialogOpen(true, cred.id)}
            title="Monitor agent — setup & live telemetry"
          >
            <SatelliteDish className="h-4 w-4" />
            Agent
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => void probeSingle(cred.id)}
            disabled={checking}
          >
            <Radar className={cn("h-4 w-4", checking && "animate-spin")} />
            Probe Now
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => void loadHistory(cred.id)}
          >
            <RefreshCw className="h-4 w-4" />
            History
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCredDialogOpen(true, cred.id)}
            aria-label="Edit vault entry"
            title="Edit credentials & specs"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            aria-label="Remove from vault"
            title="Remove from vault"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-muted-foreground" role="note">
          <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
          Passwords are never displayed here — manage them in the Access Vault.
        </p>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove server from vault?"
        description={
          <>
            Permanently remove <strong>{cred.host}:{cred.port}</strong> with its stored
            credentials and probe history? This cannot be undone.
          </>
        }
        confirmLabel="Remove Server"
        destructive
        onConfirm={() => {
          void deleteCredential(cred.id);
          selectServer(null);
        }}
      />
    </aside>
  );
}
