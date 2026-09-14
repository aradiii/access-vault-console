"use client";

// AddServersPanel — the dedicated "paste servers, we check & deploy them"
// pipeline. Two input modes:
//   1. Bulk list — one `host:port@DOMAIN\user;password` per line with a live
//      per-line preview (new / duplicate / invalid).
//   2. Single server — separate labeled fields (host, port, domain, username,
//      password) for adding one machine at a time.
// Both run the same backend check: real TCP probe + NLA banner grab, then the
// verified servers are inserted into the vault WITH their live status so they
// appear on the dashboard immediately.
//
// Visual language: restrained enterprise styling — neutral surfaces, semantic
// color reserved for small status dots, quiet typography.

import * as React from "react";
import {
  ChevronDown,
  LayoutDashboard,
  ListPlus,
  Loader2,
  Plus,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsoleStore } from "@/lib/store";
import { credentialKey, parseCredentialLine } from "@/lib/credential-parser";
import type { EndpointStatus } from "@/lib/console-types";
import { cn } from "@/lib/utils";

type PreviewKind = "new" | "duplicate" | "invalid";

interface PreviewRow {
  line: number;
  raw: string;
  kind: PreviewKind;
  reason?: string;
  host?: string;
  port?: number;
  domain?: string;
  username?: string;
}

type Phase = "input" | "checking" | "results";
type InputMode = "bulk" | "single";

interface ResultRow {
  index: number;
  raw: string;
  outcome: "added" | "duplicate" | "invalid" | "limit";
  reason?: string;
  host?: string;
  port?: number;
  domain?: string;
  username?: string;
  status?: EndpointStatus;
  latency?: number | null;
  osName?: string | null;
  osVersion?: string | null;
  computerName?: string | null;
}

interface VerifyResponse {
  results: ResultRow[];
  summary: {
    totalLines: number;
    added: number;
    reachable: number;
    duplicates: number;
    invalid: number;
    limited: number;
  };
  credentials: unknown[];
}

// Quiet semantic dots — used sparingly, never as big badges.
const DOT: Record<string, string> = {
  online: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-red-500",
  new: "bg-emerald-500",
  duplicate: "bg-amber-500",
  invalid: "bg-red-500",
};

const STATUS_TEXT: Record<string, string> = {
  online: "text-emerald-600 dark:text-emerald-400",
  degraded: "text-amber-600 dark:text-amber-400",
  offline: "text-red-600 dark:text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  online: "reachable",
  degraded: "slow reply",
  offline: "no reply",
};

const OUTCOME_ORDER: Record<ResultRow["outcome"], number> = {
  added: 0,
  duplicate: 1,
  invalid: 2,
  limit: 3,
};

const HOST_RE = /^[a-zA-Z0-9.\-_]+$/;

const EMPTY_SINGLE = {
  host: "",
  port: "3389",
  domain: "",
  username: "",
  password: "",
};

export function AddServersPanel({
  defaultOpen = true,
}: {
  defaultOpen?: boolean;
}) {
  const credentials = useConsoleStore((s) => s.credentials);
  const applyCredentials = useConsoleStore((s) => s.applyCredentials);
  const refreshAfterMutation = useConsoleStore((s) => s.refreshAfterMutation);
  const setActiveTab = useConsoleStore((s) => s.setActiveTab);

  const [open, setOpen] = React.useState(defaultOpen);
  const [phase, setPhase] = React.useState<Phase>("input");
  const [mode, setMode] = React.useState<InputMode>("bulk");
  const [text, setText] = React.useState("");
  const [single, setSingle] = React.useState({ ...EMPTY_SINGLE });
  const [results, setResults] = React.useState<ResultRow[]>([]);
  const [summary, setSummary] = React.useState<VerifyResponse["summary"] | null>(
    null
  );

  // Live parse preview — recomputed while typing, no server round-trip.
  const preview = React.useMemo<{
    rows: PreviewRow[];
    newCount: number;
    dupCount: number;
    invalidCount: number;
  }>(() => {
    const rows: PreviewRow[] = [];
    const seen = new Set<string>();
    let newCount = 0;
    let dupCount = 0;
    let invalidCount = 0;

    const vaultKeys = new Set(
      credentials.map((c) => credentialKey(c.host, c.port, c.username))
    );

    text.split(/\r?\n/).forEach((line, i) => {
      const raw = line.trim();
      if (!raw) return;
      const parsed = parseCredentialLine(raw);
      if (!parsed.ok || !parsed.entry) {
        invalidCount++;
        rows.push({
          line: i + 1,
          raw,
          kind: "invalid",
          reason: parsed.reason ?? "unparseable line",
        });
        return;
      }
      const key = credentialKey(
        parsed.entry.host,
        parsed.entry.port,
        parsed.entry.username
      );
      const entry = parsed.entry;
      if (vaultKeys.has(key)) {
        dupCount++;
        rows.push({
          line: i + 1,
          raw,
          kind: "duplicate",
          reason: "already in the vault",
          host: entry.host,
          port: entry.port,
          domain: entry.domain,
          username: entry.username,
        });
        return;
      }
      if (seen.has(key)) {
        dupCount++;
        rows.push({
          line: i + 1,
          raw,
          kind: "duplicate",
          reason: "repeated in this list",
          host: entry.host,
          port: entry.port,
          domain: entry.domain,
          username: entry.username,
        });
        return;
      }
      seen.add(key);
      newCount++;
      rows.push({
        line: i + 1,
        raw,
        kind: "new",
        host: entry.host,
        port: entry.port,
        domain: entry.domain,
        username: entry.username,
      });
    });

    return { rows, newCount, dupCount, invalidCount };
  }, [text, credentials]);

  const busy = phase === "checking";

  // --- single-server form validation ----------------------------------------
  const singleHostOk =
    single.host.trim().length > 0 &&
    single.host.trim().length <= 120 &&
    HOST_RE.test(single.host.trim());
  const singlePortOk =
    Number.isInteger(Number(single.port)) &&
    Number(single.port) >= 1 &&
    Number(single.port) <= 65535;
  const singleDomainOk =
    single.domain.trim().length > 0 && single.domain.trim().length <= 80;
  const singleUserOk =
    single.username.trim().length > 0 && single.username.trim().length <= 80;
  const singlePassOk =
    single.password.length > 0 && single.password.length <= 200;
  const singleReady =
    singleHostOk &&
    singlePortOk &&
    singleDomainOk &&
    singleUserOk &&
    singlePassOk;

  // --- the shared verify pipeline ---------------------------------------------
  const runVerify = async (verifyText: string) => {
    if (busy || !verifyText.trim()) return;
    setPhase("checking");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    try {
      const res = await fetch("/api/rdp/import-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: verifyText }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as VerifyResponse;
      setResults(data.results ?? []);
      setSummary(data.summary ?? null);
      if (Array.isArray(data.credentials)) {
        applyCredentials(data.credentials as never[]);
      }
      void refreshAfterMutation(); // refresh audit trail too
      const s = data.summary;
      if (s?.added > 0) {
        toast.success(
          `${s.added} server${s.added === 1 ? "" : "s"} deployed — ${s.reachable} reachable.`
        );
      } else {
        toast.info("Nothing new to add — all lines were duplicates or invalid.");
      }
      setPhase("results");
    } catch (err) {
      clearTimeout(timer);
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "the check took too long"
          : err instanceof Error
            ? err.message
            : "unknown error";
      toast.error("Add & verify failed: " + msg);
      setPhase("input");
    }
  };

  const handleReset = () => {
    setText("");
    setSingle({ ...EMPTY_SINGLE });
    setResults([]);
    setSummary(null);
    setPhase("input");
  };

  const handleRunSingle = async () => {
    if (!singleReady || busy) return;
    const host = single.host.trim();
    const line = `${host}:${Number(single.port)}@${single.domain.trim()}\\${single.username.trim()};${single.password}`;
    await runVerify(line);
  };

  const sortedResults = React.useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
          a.index - b.index
      ),
    [results]
  );

  const invalidInputClass =
    "border-destructive/60 focus-visible:ring-destructive/25";

  return (
    <Card className="mb-7 overflow-hidden border-border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="add-servers-content"
        className="flex w-full items-center gap-3.5 p-4 text-left transition-colors hover:bg-muted/40 sm:px-5"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ListPlus className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              Add servers
            </h2>
            <span className="hidden rounded-md border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">
              Auto-detects Windows
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Paste your credentials — every server is verified, then deployed to
            the dashboard with live status.
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <CardContent id="add-servers-content" className="border-t border-border px-4 pb-5 pt-4 sm:px-5">
          {phase !== "results" ? (
            <div className="space-y-4">
              {/* Mode switch — segmented control */}
              <div
                role="tablist"
                aria-label="Input mode"
                className="inline-flex items-center rounded-lg bg-muted p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "bulk"}
                  onClick={() => setMode("bulk")}
                  disabled={busy}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-60",
                    mode === "bulk"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Paste list
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "single"}
                  onClick={() => setMode("single")}
                  disabled={busy}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-60",
                    mode === "single"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Single server
                </button>
              </div>

              {mode === "bulk" ? (
                <>
                  {/* The dedicated bulk input field */}
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={busy}
                    spellCheck={false}
                    rows={5}
                    placeholder={
                      "192.0.2.10:3389@fabrikam\\azureadmin;ExamplePass1!\n" +
                      "203.0.113.10@EXAMPLE\\vmadmin;ExamplePass2!\n" +
                      "# lines starting with # are ignored"
                    }
                    aria-label="Server list to check and add"
                    className="w-full resize-y rounded-md border border-input bg-muted/30 p-3.5 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Format{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">
                      host:port@DOMAIN\user;password
                    </code>{" "}
                    — one server per line, port optional (default 3389).
                  </p>

                  {/* Quiet live stats */}
                  {preview.rows.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {preview.rows.length} line{preview.rows.length === 1 ? "" : "s"} parsed
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", DOT.new)} aria-hidden="true" />
                        {preview.newCount} new
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", DOT.duplicate)} aria-hidden="true" />
                        {preview.dupCount} duplicate
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", DOT.invalid)} aria-hidden="true" />
                        {preview.invalidCount} invalid
                      </span>
                    </div>
                  )}

                  {/* Live per-line preview */}
                  {preview.rows.length > 0 && (
                    <div className="scrollbar-thin max-h-44 overflow-y-auto rounded-md border border-border">
                      <ul className="divide-y divide-border/70 text-xs">
                        {preview.rows.map((row) => (
                          <li
                            key={row.line}
                            className="flex items-center justify-between gap-3 px-3 py-2"
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span
                                className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/60"
                                aria-hidden="true"
                              >
                                {row.line}
                              </span>
                              <span className="truncate font-mono">
                                {row.kind === "invalid" ? (
                                  <span className="text-muted-foreground">{row.raw}</span>
                                ) : (
                                  <>
                                    {row.host}
                                    <span className="text-muted-foreground">:{row.port}</span>
                                    <span className="text-muted-foreground/70">
                                      {" @ "}
                                      {row.domain}\{row.username}
                                    </span>
                                  </>
                                )}
                              </span>
                            </span>
                            {row.kind === "new" ? (
                              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className={cn("h-1.5 w-1.5 rounded-full", DOT.new)} aria-hidden="true" />
                                new
                              </span>
                            ) : (
                              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    row.kind === "duplicate" ? DOT.duplicate : DOT.invalid
                                  )}
                                  aria-hidden="true"
                                />
                                {row.reason}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      onClick={() => void runVerify(text)}
                      disabled={preview.newCount === 0 || busy}
                      size="sm"
                    >
                      {busy ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Verifying…
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                          Verify &amp; add
                          {preview.newCount > 0 && (
                            <span className="ml-1.5 tabular-nums">{preview.newCount}</span>
                          )}
                        </>
                      )}
                    </Button>
                    {text.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={handleReset} disabled={busy}>
                        <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        Clear
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Single-server mode — a separate field per part */}
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="sv-host" className="text-xs font-medium">
                        Host / IP <span className="text-muted-foreground">*</span>
                      </Label>
                      <Input
                        id="sv-host"
                        value={single.host}
                        onChange={(e) => setSingle((s) => ({ ...s, host: e.target.value }))}
                        disabled={busy}
                        placeholder="192.0.2.10"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={single.host.length > 0 && !singleHostOk}
                        className={cn(
                          "h-9",
                          single.host.length > 0 && !singleHostOk && invalidInputClass
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sv-port" className="text-xs font-medium">
                        RDP Port
                      </Label>
                      <Input
                        id="sv-port"
                        value={single.port}
                        onChange={(e) => setSingle((s) => ({ ...s, port: e.target.value }))}
                        disabled={busy}
                        inputMode="numeric"
                        placeholder="3389"
                        autoComplete="off"
                        aria-invalid={!singlePortOk}
                        className={cn("h-9", !singlePortOk && invalidInputClass)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sv-domain" className="text-xs font-medium">
                        Domain <span className="text-muted-foreground">*</span>
                      </Label>
                      <Input
                        id="sv-domain"
                        value={single.domain}
                        onChange={(e) => setSingle((s) => ({ ...s, domain: e.target.value }))}
                        disabled={busy}
                        placeholder="Kv-lab"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={single.domain.length > 0 && !singleDomainOk}
                        className={cn(
                          "h-9",
                          single.domain.length > 0 && !singleDomainOk && invalidInputClass
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sv-user" className="text-xs font-medium">
                        Username <span className="text-muted-foreground">*</span>
                      </Label>
                      <Input
                        id="sv-user"
                        value={single.username}
                        onChange={(e) => setSingle((s) => ({ ...s, username: e.target.value }))}
                        disabled={busy}
                        placeholder="admin123"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={single.username.length > 0 && !singleUserOk}
                        className={cn(
                          "h-9",
                          single.username.length > 0 && !singleUserOk && invalidInputClass
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sv-pass" className="text-xs font-medium">
                        Password <span className="text-muted-foreground">*</span>
                      </Label>
                      <Input
                        id="sv-pass"
                        type="password"
                        value={single.password}
                        onChange={(e) => setSingle((s) => ({ ...s, password: e.target.value }))}
                        disabled={busy}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        aria-invalid={single.password.length > 0 && !singlePassOk}
                        className={cn(
                          "h-9",
                          single.password.length > 0 && !singlePassOk && invalidInputClass
                        )}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button onClick={() => void handleRunSingle()} disabled={!singleReady || busy} size="sm">
                      {busy ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Verifying…
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                          Verify &amp; add
                        </>
                      )}
                    </Button>
                    {(single.host || single.domain || single.username || single.password) && (
                      <Button variant="ghost" size="sm" onClick={handleReset} disabled={busy}>
                        <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        Clear
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    The server is probed for real reachability, then deployed to
                    the dashboard with its live status.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary strip */}
              {summary && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/30 px-3.5 py-2.5 text-xs">
                  <span className="font-semibold text-foreground">
                    {summary.added} server{summary.added === 1 ? "" : "s"} added
                  </span>
                  <span className="text-muted-foreground">
                    · {summary.reachable} reachable · {summary.duplicates} duplicate
                    {summary.duplicates === 1 ? "" : "s"} skipped · {summary.invalid} invalid
                    {summary.limited > 0 ? ` · ${summary.limited} over limit` : ""}
                  </span>
                </div>
              )}

              {/* Per-server results */}
              <div className="scrollbar-thin max-h-64 overflow-y-auto rounded-md border border-border">
                <ul className="divide-y divide-border/70 text-xs">
                  {sortedResults.map((row) => (
                    <li key={row.index} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2.5">
                        {row.outcome === "added" ? (
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              DOT[row.status ?? "offline"] ?? DOT.offline
                            )}
                            aria-hidden="true"
                          />
                        ) : (
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              row.outcome === "duplicate"
                                ? DOT.duplicate
                                : row.outcome === "invalid"
                                  ? DOT.invalid
                                  : "bg-zinc-400 dark:bg-zinc-500"
                            )}
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate font-mono">
                          {row.host ? (
                            <>
                              {row.host}
                              <span className="text-muted-foreground">:{row.port}</span>
                              <span className="text-muted-foreground/70">
                                {" @ "}
                                {row.domain}\{row.username}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{row.raw}</span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[11px]">
                        {row.outcome === "added" && (
                          <span className="text-muted-foreground">
                            <span className={cn("font-medium", STATUS_TEXT[row.status ?? "offline"])}>
                              {STATUS_LABEL[row.status ?? "offline"] ?? "no reply"}
                            </span>
                            {row.latency != null && ` · ${row.latency} ms`}
                            {row.osName && ` · ${row.osName}`}
                            {row.computerName && ` · ${row.computerName}`}
                          </span>
                        )}
                        {row.outcome === "duplicate" && (
                          <span className="text-muted-foreground">{row.reason}</span>
                        )}
                        {row.outcome === "invalid" && (
                          <span className="text-muted-foreground">{row.reason}</span>
                        )}
                        {row.outcome === "limit" && (
                          <span className="text-muted-foreground">{row.reason}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleReset}>
                  <ListPlus className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  Add more
                </Button>
                <Button size="sm" onClick={() => setActiveTab("dashboard")}>
                  <LayoutDashboard className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  Open dashboard
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
