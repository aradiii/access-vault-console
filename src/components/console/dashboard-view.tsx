"use client";

import * as React from "react";
import { useConsoleStore } from "@/lib/store";
import { PageHeader } from "./page-header";
import { MetricsGrid } from "./metrics-grid";
import { FleetTable } from "./fleet-table";
import { DetailsPanel } from "./details-panel";
import { AddServersPanel } from "./add-servers-panel";

export function DashboardView() {
  const countdownSec = useConsoleStore((s) => s.countdownSec);
  const settings = useConsoleStore((s) => s.settings);

  return (
    <section aria-label="Fleet Overview">
      <PageHeader
        kicker="Operations"
        title="Remote Desktop Operations Center"
        description="Live TCP reachability and latency monitoring for the operator fleet. Every server listed here is a real entry from the Access Vault — statuses update through genuine port-3389 probes."
        actions={
          <div
            className="flex items-center gap-3 rounded-md border border-border bg-card px-3.5 py-2"
            title={`Auto probe interval: ${settings.probeIntervalSec}s`}
          >
            <span className="ops-pulse h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <div className="text-xs leading-tight">
              <span className="block text-muted-foreground">Auto-refresh</span>
              <span className="font-semibold tabular-nums" aria-live="polite">
                {countdownSec}s
              </span>
            </div>
          </div>
        }
      />

      {/* Add Servers — dedicated field, visible right on the dashboard */}
      <AddServersPanel defaultOpen />

      <MetricsGrid />

      {/* Table + Details panel */}
      <DetailsAwareLayout />
    </section>
  );
}

function DetailsAwareLayout() {
  const selectedId = useConsoleStore((s) => s.selectedId);

  return (
    <div className={selectedId ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" : ""}>
      <FleetTable />
      {selectedId && <DetailsPanel />}
    </div>
  );
}
