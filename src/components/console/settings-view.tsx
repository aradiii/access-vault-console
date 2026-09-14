"use client";

import * as React from "react";
import { Eraser, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConsoleStore } from "@/lib/store";
import { ConfirmDialog } from "./confirm-dialog";
import { PageHeader } from "./page-header";

export function SettingsView() {
  const settings = useConsoleStore((s) => s.settings);
  const credentials = useConsoleStore((s) => s.credentials);
  const saveSettings = useConsoleStore((s) => s.saveSettings);
  const clearProbeData = useConsoleStore((s) => s.clearProbeData);
  const clearAllData = useConsoleStore((s) => s.clearAllData);

  const [confirmReset, setConfirmReset] = React.useState(false);
  const [confirmWipe, setConfirmWipe] = React.useState(false);

  return (
    <section aria-label="System Settings" className="mx-auto max-w-3xl">
      <PageHeader
        kicker="Configuration"
        title="Settings & Backend"
        description="Console behavior, theme, and data management. Changes persist server-side and apply immediately. All probes are live TCP — there is no simulation mode."
      />

      <div className="flex flex-col gap-4">
        {/* Behavior */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Probe Behavior
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Auto-probe interval</span>
              <Select
                value={String(settings.probeIntervalSec)}
                onValueChange={(v) =>
                  void saveSettings({ probeIntervalSec: Number(v) })
                }
              >
                <SelectTrigger aria-label="Probe interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 seconds</SelectItem>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="60">1 minute</SelectItem>
                  <SelectItem value="300">5 minutes</SelectItem>
                  <SelectItem value="900">15 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Theme</span>
              <Select
                value={settings.theme}
                onValueChange={(v) => void saveSettings({ theme: v as "dark" | "light" })}
              >
                <SelectTrigger aria-label="Theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={settings.desktopNotifications}
                onChange={(e) => void saveSettings({ desktopNotifications: e.target.checked })}
              />
              Desktop notifications for probe results
            </label>
          </div>
        </div>

        {/* Data management */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Data Management
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setConfirmReset(true)}>
              <Eraser className="h-4 w-4" /> Clear Probe History
            </Button>
            <Button variant="destructive" onClick={() => setConfirmWipe(true)}>
              <Trash className="h-4 w-4" /> Wipe Console Data
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The Access Vault credentials ({credentials.length} servers) are never
            removed by these actions — manage them from the Access Vault tab or
            export them there (.txt / .json).
          </p>
        </div>

        {/* API scheme */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Backend API Scheme
          </h2>
          <ul className="scrollbar-thin max-h-64 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            <li>POST /api/rdp/monitor (fleet-wide live TCP) · POST /api/rdp/check</li>
            <li>GET /api/rdp/history/:id · POST /api/rdp/reset</li>
            <li>GET/POST /api/rdp/credentials · PUT/DELETE /api/rdp/credentials/:id</li>
            <li>POST /api/rdp/credentials/import</li>
            <li>GET/POST/DELETE /api/activities · GET/PUT /api/settings</li>
          </ul>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Clear probe history?"
        description="All probe records will be erased and every server status reset to unknown. Vault credentials and the activity log are kept."
        confirmLabel="Clear History"
        onConfirm={() => void clearProbeData()}
      />
      <ConfirmDialog
        open={confirmWipe}
        onOpenChange={setConfirmWipe}
        title="Wipe console data?"
        description="Probe history, statuses, the activity log, and settings will be permanently erased. Your vault credentials are preserved. This cannot be undone."
        confirmLabel="Wipe Console Data"
        destructive
        onConfirm={() => void clearAllData()}
      />
    </section>
  );
}
