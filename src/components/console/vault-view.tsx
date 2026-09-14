"use client";

import * as React from "react";
import {
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LogIn,
  MemoryStick,
  Monitor,
  MonitorSmartphone,
  Network,
  Pencil,
  Plus,
  SatelliteDish,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Download,
  ClipboardList,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  computeVaultStats,
  credentialSpecsLabel,
  credentialToLine,
  filterAndSortCredentials,
  useConsoleStore,
} from "@/lib/store";
import { copyToClipboard, downloadTextFile } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { AddServersPanel } from "./add-servers-panel";
import { PageHeader } from "./page-header";

export function VaultView() {
  const credentials = useConsoleStore((s) => s.credentials);
  const vaultFilters = useConsoleStore((s) => s.vaultFilters);
  const setVaultFilter = useConsoleStore((s) => s.setVaultFilter);
  const setCredDialogOpen = useConsoleStore((s) => s.setCredDialogOpen);
  const setImportDialogOpen = useConsoleStore((s) => s.setImportDialogOpen);
  const setSessionDialogOpen = useConsoleStore((s) => s.setSessionDialogOpen);
  const setAgentDialogOpen = useConsoleStore((s) => s.setAgentDialogOpen);
  const deleteCredential = useConsoleStore((s) => s.deleteCredential);
  const credBusyIds = useConsoleStore((s) => s.credBusyIds);

  const [revealedIds, setRevealedIds] = React.useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const filtered = React.useMemo(
    () => filterAndSortCredentials(credentials, vaultFilters),
    [credentials, vaultFilters]
  );

  const stats = React.useMemo(() => computeVaultStats(credentials), [credentials]);

  const domains = React.useMemo(
    () => Array.from(new Set(credentials.map((c) => c.domain || "local"))).sort(),
    [credentials]
  );

  const confirmTarget = credentials.find((c) => c.id === confirmDeleteId) ?? null;
  const revealAll = vaultFilters.revealAll;

  const isRevealed = (id: string) => revealAll || revealedIds.has(id);
  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success(`${label} copied to clipboard.`);
    else toast.error("Clipboard copy failed.");
  };

  const handleExportTxt = () => {
    const content = filtered.map(credentialToLine).join("\n") + "\n";
    downloadTextFile(`rdp-vault-${new Date().toISOString().slice(0, 10)}.txt`, content);
  };

  const handleExportJson = () => {
    const content = JSON.stringify(
      { version: "2.5.0", exportDate: new Date().toISOString(), credentials: filtered },
      null,
      2
    );
    downloadTextFile(
      `rdp-vault-${new Date().toISOString().slice(0, 10)}.json`,
      content,
      "application/json"
    );
  };

  const statCards = [
    { key: "total", label: "Total Entries", value: String(stats.total), icon: KeyRound, valueClass: "" },
    { key: "domains", label: "Unique Domains", value: String(stats.domains), icon: Globe, valueClass: "" },
    { key: "cores", label: "Total vCores", value: stats.totalCores != null ? String(stats.totalCores) : "--", icon: Cpu, valueClass: "", sub: stats.coresKnown > 0 ? `${stats.coresKnown}/${stats.total} defined` : "not defined yet" },
    { key: "ram", label: "Total RAM", value: stats.totalRamGb != null ? `${stats.totalRamGb} GB` : "--", icon: MemoryStick, valueClass: "", sub: stats.ramKnown > 0 ? `${stats.ramKnown}/${stats.total} defined` : "not defined yet" },
    { key: "hosts", label: "Unique Hosts", value: String(stats.uniqueHosts), icon: Network, valueClass: "" },
    { key: "rdp", label: "RDP :3389 Entries", value: String(stats.rdpPort), icon: MonitorSmartphone, valueClass: "" },
  ];

  return (
    <section aria-label="Access Vault — Credential Manager">
      <PageHeader
        kicker="Credentials"
        title="Access Vault"
        description="Centralized storage for remote desktop credentials with one-click copy, masked-by-default secrets, per-server hardware specs (vCPU / RAM) with fleet totals, bulk import/export, and a full audit trail."
        actions={
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3.5 py-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div className="text-xs leading-tight">
              <span className="block font-medium">Secrets masked</span>
              <span className="block text-muted-foreground">Passwords hidden by default</span>
            </div>
          </div>
        }
      />

      {/* Add Servers — dedicated paste / check / deploy field */}
      <AddServersPanel />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.key} className="shadow-sm">
              <CardContent className="flex flex-col gap-1.5 p-5">
                <div className="flex items-center justify-between text-[13px] font-medium text-muted-foreground">
                  <span>{s.label}</span>
                  <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                </div>
                <div className={cn("text-[24px] font-bold leading-none tracking-tight", s.valueClass)}>
                  {s.value}
                </div>
                {s.sub && <div className="text-[11px] text-muted-foreground">{s.sub}</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border border-b-0 border-border bg-card p-4">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={vaultFilters.search}
            onChange={(e) => setVaultFilter({ search: e.target.value })}
            placeholder="Search host, domain, user, or note..."
            aria-label="Search credentials"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={vaultFilters.domain} onValueChange={(v) => setVaultFilter({ domain: v })}>
            <SelectTrigger className="w-[160px]" aria-label="Filter by Domain">
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
            value={vaultFilters.sort}
            onValueChange={(v) => setVaultFilter({ sort: v as typeof vaultFilters.sort })}
          >
            <SelectTrigger className="w-[160px]" aria-label="Sort credentials">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="domain_asc">Domain (A-Z)</SelectItem>
              <SelectItem value="host_asc">Host (A-Z)</SelectItem>
              <SelectItem value="host_desc">Host (Z-A)</SelectItem>
              <SelectItem value="user_asc">Username (A-Z)</SelectItem>
              <SelectItem value="recent">Recently Updated</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={revealAll ? "secondary" : "outline"}
            size="sm"
            onClick={() => setVaultFilter({ revealAll: !revealAll })}
            aria-pressed={revealAll}
            aria-label={revealAll ? "Mask all passwords" : "Reveal all passwords"}
          >
            {revealAll ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            <span>{revealAll ? "Mask All" : "Reveal All"}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Export vault">
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export {filtered.length} shown entries</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleExportTxt()}>
                <Download className="h-4 w-4" aria-hidden="true" /> Download .txt
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExportJson()}>
                <Download className="h-4 w-4" aria-hidden="true" /> Download .json
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void handleCopy(
                    filtered.map(credentialToLine).join("\n"),
                    `${filtered.length} connection line${filtered.length === 1 ? "" : "s"}`
                  )
                }
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" /> Copy all lines
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)} aria-label="Import credentials">
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Import</span>
          </Button>

          <Button size="sm" onClick={() => setCredDialogOpen(true)} aria-label="Add new vault entry">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Add Entry</span>
          </Button>
        </div>
      </div>

      {/* Table (desktop) */}
      <div className="hidden rounded-b-xl border border-border bg-card md:block">
        {credentials.length === 0 ? (
          <EmptyVault onAdd={() => setCredDialogOpen(true)} onImport={() => setImportDialogOpen(true)} />
        ) : filtered.length === 0 ? (
          <NoMatches />
        ) : (
          <div className="scrollbar-thin max-h-[620px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[52px] text-center">#</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="min-w-[180px]">Password</TableHead>
                  <TableHead>Specs (vCPU / RAM)</TableHead>
                  <TableHead className="hidden xl:table-cell">Notes</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c, idx) => {
                  const revealed = isRevealed(c.id);
                  const busy = !!credBusyIds[c.id];
                  const specs = credentialSpecsLabel(c);
                  return (
                    <TableRow key={c.id} data-testid="vault-row">
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[13px] font-semibold">
                            {c.host}:<span className="text-muted-foreground">{c.port}</span>
                          </span>
                          <IconCopyButton
                            label={`Copy address ${c.host}:${c.port}`}
                            onCopy={() => void handleCopy(`${c.host}:${c.port}`, "Address")}
                          />
                        </div>
                        {c.osVersion && (
                          <div
                            className="mt-0.5 flex max-w-[210px] items-center gap-1 text-[11px] text-muted-foreground"
                            title={`${c.osVersion}${c.computerName ? ` · ${c.computerName}` : ""}`}
                          >
                            <Monitor className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">
                              {c.osName ?? c.osVersion}
                              {c.computerName ? ` · ${c.computerName}` : ""}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="max-w-[170px] font-mono text-[11px]">
                            <span className="truncate">{c.domain}\{c.username}</span>
                          </Badge>
                          <IconCopyButton
                            label={`Copy account ${c.domain}\\${c.username}`}
                            onCopy={() => void handleCopy(`${c.domain}\\${c.username}`, "Account")}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span
                            className={cn(
                              "min-w-[8ch] font-mono text-[13px]",
                              revealed ? "text-amber-700 dark:text-amber-400" : "tracking-widest text-muted-foreground"
                            )}
                            aria-label={revealed ? "Password revealed" : "Password masked"}
                          >
                            {revealed ? c.password : "••••••••••"}
                          </span>
                          <IconCopyButton
                            label="Copy password"
                            onCopy={() => void handleCopy(c.password, "Password")}
                          />
                          <IconCopyButton
                            label={revealed ? "Hide password" : "Show password"}
                            onClick={() => toggleReveal(c.id)}
                            active={revealed}
                          >
                            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </IconCopyButton>
                        </div>
                      </TableCell>
                      <TableCell>
                        {specs ? (
                          <span className="font-mono text-xs text-foreground">{specs}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCredDialogOpen(true, c.id)}
                            className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                            aria-label={`Set specs for ${c.host}`}
                          >
                            not set — click to edit
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-[200px] truncate text-xs text-muted-foreground xl:table-cell">
                        {c.notes || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
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
                            className="h-8 w-8"
                            onClick={() => setCredDialogOpen(true, c.id)}
                            aria-label={`Edit entry for ${c.host}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setConfirmDeleteId(c.id)}
                            disabled={busy}
                            aria-label={`Delete entry for ${c.host}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Cards (mobile) */}
      <div className="rounded-b-xl border border-border bg-card md:hidden">
        {credentials.length === 0 ? (
          <EmptyVault onAdd={() => setCredDialogOpen(true)} onImport={() => setImportDialogOpen(true)} />
        ) : filtered.length === 0 ? (
          <NoMatches />
        ) : (
          <ul className="scrollbar-thin max-h-[70vh] divide-y divide-border overflow-y-auto">
            {filtered.map((c) => {
              const revealed = isRevealed(c.id);
              const busy = !!credBusyIds[c.id];
              const specs = credentialSpecsLabel(c);
              return (
                <li key={c.id} className="flex flex-col gap-2.5 p-4" data-testid="vault-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold">
                      {c.host}:<span className="text-muted-foreground">{c.port}</span>
                    </span>
                    <Badge variant="outline" className="max-w-[160px] font-mono text-[10px]">
                      <span className="truncate">{c.domain}</span>
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    <span className="text-muted-foreground">
                      User: <span className="font-mono text-foreground">{c.username}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">Pass:</span>
                      <span
                        className={cn(
                          "font-mono",
                          revealed ? "text-amber-700 dark:text-amber-400" : "tracking-widest text-muted-foreground"
                        )}
                      >
                        {revealed ? c.password : "••••••••"}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {specs ? (
                      <span className="font-mono text-foreground">{specs}</span>
                    ) : (
                      <span className="text-muted-foreground">Specs: not set</span>
                    )}
                    {c.osVersion && (
                      <span
                        className="flex items-center gap-1 text-muted-foreground"
                        title={`${c.osVersion}${c.computerName ? ` · ${c.computerName}` : ""}`}
                      >
                        <Monitor className="h-3 w-3" aria-hidden="true" />
                        {c.osName ?? c.osVersion}
                      </span>
                    )}
                    {c.notes && <span className="text-muted-foreground">· {c.notes}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => void handleCopy(`${c.host}:${c.port}`, "Address")}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> IP
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => void handleCopy(`${c.domain}\\${c.username}`, "Account")}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> User
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => void handleCopy(c.password, "Password")}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Pass
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => toggleReveal(c.id)}
                      aria-pressed={revealed}
                    >
                      {revealed ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                      {revealed ? "Hide" : "Show"}
                    </Button>
                    <span className="grow" />
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
                      className="h-8 w-8"
                      onClick={() => setCredDialogOpen(true, c.id)}
                      aria-label={`Edit entry for ${c.host}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmDeleteId(c.id)}
                      disabled={busy}
                      aria-label={`Delete entry for ${c.host}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground" role="note">
        Showing {filtered.length} of {credentials.length} vault entries. Hardware specs are
        operator-supplied — edit an entry to record its vCPU count and RAM. All vault
        modifications are recorded in the Operational Activity log.
      </p>

      {/* Dialogs are mounted globally in ConsoleShell */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Delete vault entry?"
        description={
          confirmTarget ? (
            <>
              Permanently remove the stored credentials for{" "}
              <strong className="font-mono">
                {confirmTarget.host}:{confirmTarget.port}
              </strong>{" "}
              ({confirmTarget.domain}\{confirmTarget.username})? This cannot be undone.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete Entry"
        destructive
        onConfirm={() => {
          if (confirmDeleteId) void deleteCredential(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </section>
  );
}

function IconCopyButton({
  label,
  onCopy,
  onClick,
  active,
  children,
}: {
  label: string;
  onCopy?: () => void;
  onClick?: () => void;
  active?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "h-7 w-7 text-muted-foreground hover:text-foreground",
        active && "text-amber-600 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400"
      )}
      onClick={onClick ?? onCopy}
      aria-label={label}
      title={label}
      type="button"
    >
      {children ?? <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </Button>
  );
}

function EmptyVault({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <KeyRound className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="font-semibold">The vault is empty</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Add entries manually or import a credential list in the standard
          host:port@DOMAIN\user;password format.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onImport}>
          <Upload className="h-4 w-4" aria-hidden="true" /> Import List
        </Button>
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Entry
        </Button>
      </div>
    </div>
  );
}

function NoMatches() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="font-semibold">No matching entries</p>
      <p className="text-sm text-muted-foreground">
        Adjust the search term or domain filter to see more of the vault.
      </p>
    </div>
  );
}
