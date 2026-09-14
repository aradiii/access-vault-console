"use client";

import * as React from "react";
import { Cpu, Info, LogIn, MemoryStick, Monitor, Radar, SatelliteDish, Search, Trash2 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { agentIsFresh, credentialSpecsLabel, filterAndSortFleet, useConsoleStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { StatusBadge } from "./status-badge";

export function FleetTable() {
  const credentials = useConsoleStore((s) => s.credentials);
  const filters = useConsoleStore((s) => s.filters);
  const setFilter = useConsoleStore((s) => s.setFilter);
  const selectedId = useConsoleStore((s) => s.selectedId);
  const selectServer = useConsoleStore((s) => s.selectServer);
  const probeSingle = useConsoleStore((s) => s.probeSingle);
  const deleteCredential = useConsoleStore((s) => s.deleteCredential);
  const setCredDialogOpen = useConsoleStore((s) => s.setCredDialogOpen);
  const setSessionDialogOpen = useConsoleStore((s) => s.setSessionDialogOpen);
  const setAgentDialogOpen = useConsoleStore((s) => s.setAgentDialogOpen);
  const checkingIds = useConsoleStore((s) => s.checkingIds);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const filtered = React.useMemo(
    () => filterAndSortFleet(credentials, filters),
    [credentials, filters]
  );

  const domains = React.useMemo(
    () => Array.from(new Set(credentials.map((c) => c.domain || "local"))).sort(),
    [credentials]
  );

  const confirmTarget = credentials.find((c) => c.id === confirmDeleteId) ?? null;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border border-b-0 border-border bg-card p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            placeholder="Search host, domain, or port..."
            aria-label="Search servers"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.status}
            onValueChange={(v) => setFilter({ status: v as typeof filters.status })}
          >
            <SelectTrigger className="w-[140px]" aria-label="Filter by Status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="degraded">Degraded</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.domain} onValueChange={(v) => setFilter({ domain: v })}>
            <SelectTrigger className="w-[150px]" aria-label="Filter by Domain">
              <SelectValue placeholder="Domain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Domains</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.sort}
            onValueChange={(v) => setFilter({ sort: v as typeof filters.sort })}
          >
            <SelectTrigger className="w-[170px]" aria-label="Sort by field">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Domain (A-Z)</SelectItem>
              <SelectItem value="name_desc">Domain (Z-A)</SelectItem>
              <SelectItem value="latency_asc">Latency (Low-High)</SelectItem>
              <SelectItem value="latency_desc">Latency (High-Low)</SelectItem>
              <SelectItem value="status_asc">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-b-xl border border-border bg-card">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <p className="font-semibold">No servers match</p>
            <p className="text-sm text-muted-foreground">
              {credentials.length === 0
                ? "Add an entry in the Access Vault to populate the fleet."
                : "Adjust the search term or filters."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Server</TableHead>
                <TableHead>Target (Host:Port)</TableHead>
                <TableHead className="hidden lg:table-cell">Account</TableHead>
                <TableHead className="hidden xl:table-cell">Windows</TableHead>
                <TableHead className="hidden xl:table-cell">Specs (vCPU / RAM)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead className="hidden xl:table-cell">Last Checked</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const selected = selectedId === c.id;
                const checking = !!checkingIds[c.id];
                const specs = credentialSpecsLabel(c);
                return (
                  <TableRow
                    key={c.id}
                    onClick={() => selectServer(c.id)}
                    className={cn("cursor-pointer", selected && "bg-muted/60 hover:bg-muted/60")}
                    data-testid="fleet-row"
                  >
                    <TableCell>
                      <div className="max-w-[200px]">
                        <div className="truncate text-[13px] font-semibold">{c.domain}</div>
                        {c.notes && (
                          <div className="truncate text-xs text-muted-foreground">{c.notes}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {c.host}
                      <span className="text-muted-foreground">:{c.port}</span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                      {c.domain}\{c.username}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {c.osVersion ? (
                        <span
                          className="flex max-w-[190px] items-center gap-1.5 text-xs"
                          title={`${c.osVersion}${c.computerName ? ` · ${c.computerName}` : ""}`}
                        >
                          <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{c.osName ?? c.osVersion}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {specs ? (
                        <span className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                          <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                          {specs}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCredDialogOpen(true, c.id);
                          }}
                          aria-label={`Set hardware specs for ${c.host}`}
                          title="Set specs in the vault"
                        >
                          <MemoryStick className="h-3.5 w-3.5" aria-hidden="true" />
                          set specs
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={c.status} />
                        {agentIsFresh(c) && (
                          <span
                            className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
                            title={`Agent telemetry live — CPU ${c.cpuLoad ?? "--"}% · MEM ${c.memUsedPercent ?? "--"}%`}
                            data-testid="agent-chip"
                          >
                            <SatelliteDish className="h-2.5 w-2.5" aria-hidden="true" />
                            AGENT {c.cpuLoad != null ? `· CPU ${c.cpuLoad}%` : ""}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.latency != null ? (
                        <span
                          className={cn(
                            "font-mono text-[13px] tabular-nums",
                            c.status === "degraded" ? "text-amber-600 dark:text-amber-400" : "text-foreground"
                          )}
                        >
                          {c.latency} <span className="text-muted-foreground">ms</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                      {c.lastChecked
                        ? formatDistanceToNowStrict(new Date(c.lastChecked), { addSuffix: true })
                        : "never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => setSessionDialogOpen(true, c.id)}
                          aria-label={`Login to ${c.host}`}
                          title="Login — open a live RDP session"
                        >
                          <LogIn className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => setAgentDialogOpen(true, c.id)}
                          aria-label={`Monitor agent for ${c.host}`}
                          title="Monitor agent — setup & live telemetry"
                        >
                          <SatelliteDish className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => void probeSingle(c.id)}
                          disabled={checking}
                          aria-label={`Probe ${c.host}`}
                          title="Probe now"
                        >
                          <Radar className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => selectServer(c.id)}
                          aria-label={`Details for ${c.host}`}
                          title="Details"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setConfirmDeleteId(c.id)}
                          aria-label={`Remove ${c.host}`}
                          title="Remove from vault"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Remove server from vault?"
        description={
          confirmTarget ? (
            <>
              Permanently remove <strong>{confirmTarget.host}:{confirmTarget.port}</strong> (
              {confirmTarget.domain}\{confirmTarget.username}) including its stored credentials
              and probe history? This cannot be undone.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Remove Server"
        destructive
        onConfirm={() => {
          if (confirmDeleteId) void deleteCredential(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}
