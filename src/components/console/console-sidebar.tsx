"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy, Download, Gauge, KeyRound, ScrollText, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConsoleStore, type TabKey } from "@/lib/store";
import { UtcClock } from "./utc-clock";

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: React.ElementType; aria: string }> = [
  { key: "dashboard", label: "Fleet Overview", icon: Gauge, aria: "Fleet Overview tab" },
  { key: "vault", label: "Access Vault", icon: KeyRound, aria: "Access Vault tab" },
  { key: "activity", label: "Operational Activity", icon: ScrollText, aria: "Operational Log tab" },
  { key: "settings", label: "Settings & Backend", icon: Settings2, aria: "System Settings tab" },
];

export function ConsoleSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const activeTab = useConsoleStore((s) => s.activeTab);
  const setActiveTab = useConsoleStore((s) => s.setActiveTab);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportUrl, setExportUrl] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);

  // In-page Blob download: fetches the snapshot over the same origin the app
  // already uses, wraps it in an object URL and triggers a synthetic click.
  // No new tab, no cross-tab navigation, no Content-Disposition round-trip —
  // preview proxies that strip attachment headers cannot interfere with it.
  const downloadSnapshot = async (): Promise<boolean> => {
    const targets = ["/api/download-html", "/access-vault.html"];
    for (const target of targets) {
      try {
        setDownloading(true);
        const res = await fetch(target, { cache: "no-store" });
        if (!res.ok) continue;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "access-vault.html";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast.success("Download started — access-vault.html (~494 KB)");
        return true;
      } catch {
        // try the next target
      } finally {
        setDownloading(false);
      }
    }
    toast.error("Download blocked — use the fallback options");
    return false;
  };

  // Footer entry point: one-click in-page download; on failure reveal the
  // dialog with copy-link and manual fallbacks.
  const handleFooterExport = async (e: React.MouseEvent) => {
    e.preventDefault();
    const ok = await downloadSnapshot();
    if (!ok) {
      setCopied(false);
      setExportUrl(`${window.location.origin}/api/download-html`);
      setExportOpen(true);
    }
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportUrl);
      setCopied(true);
      toast.success("Link copied — paste it into a new browser tab");
    } catch {
      const el = document.getElementById("export-url-input") as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
        document.execCommand("copy");
        setCopied(true);
        toast.success("Link copied");
      } else {
        toast.error("Copy failed — select the link text manually");
      }
    }
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-xs font-bold text-background">
          RD
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight tracking-tight">
            Operations Console
          </div>
          <div className="text-[11px] text-muted-foreground">
            Remote Desktop Fleet
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 p-3" aria-label="Main Navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.aria}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setActiveTab(item.key);
                onNavigate?.();
              }}
              className={cn(
                "relative flex w-full items-center gap-3 rounded-md px-3.5 py-2 text-left text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
                  aria-hidden="true"
                />
              )}
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-5 py-4 text-[11px] text-muted-foreground">
        <div>Engine: v2.5.0-console</div>
        <UtcClock className="mt-1 block font-mono tabular-nums" />
        <a
          href="/api/download-html"
          download="access-vault.html"
          aria-label="Download static HTML snapshot of the console"
          onClick={(e) => void handleFooterExport(e)}
          aria-disabled={downloading}
          className="mt-2.5 flex w-fit items-center gap-1.5 rounded-sm text-[11px] transition-colors hover:text-foreground"
        >
          <Download
            className={cn("h-3 w-3 shrink-0", downloading && "animate-pulse")}
            aria-hidden="true"
          />
          {downloading ? "Preparing…" : "Export HTML"}
        </a>
      </div>

      {/* Export dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Export HTML snapshot</DialogTitle>
            <DialogDescription>
              Full offline copy of this console (~494 KB). Download runs entirely in-page; if the
              sandbox still blocks it, copy the link into a new browser tab instead.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                id="export-url-input"
                readOnly
                value={exportUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Direct download link"
                className="min-w-0 flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
              <Button type="button" size="sm" onClick={() => void copyExport()}>
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button
              type="button"
              onClick={() => void downloadSnapshot()}
              disabled={downloading}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {downloading ? "Preparing…" : "Download access-vault.html"}
            </Button>
            <Button asChild variant="outline">
              <a href="/api/download-html" download="access-vault.html">
                Direct link fallback
              </a>
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Manual fallback: open{" "}
              <span className="font-mono text-foreground">/access-vault.html</span>, press{" "}
              <span className="font-mono text-foreground">Ctrl+U</span> then{" "}
              <span className="font-mono text-foreground">Ctrl+A</span> and{" "}
              <span className="font-mono text-foreground">Ctrl+C</span>, paste into Notepad and
              save as <span className="font-mono text-foreground">access-vault.html</span>.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
