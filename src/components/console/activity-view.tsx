"use client";

import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConsoleStore } from "@/lib/store";
import { ConfirmDialog } from "./confirm-dialog";
import { PageHeader } from "./page-header";

export function ActivityView() {
  const activities = useConsoleStore((s) => s.activities);
  const clearActivities = useConsoleStore((s) => s.clearActivities);
  const [confirmClear, setConfirmClear] = React.useState(false);

  return (
    <section aria-label="Operational Activity">
      <PageHeader
        kicker="Audit"
        title="Operational Activity"
        description="Server-side audit log of every console action: fleet probes, vault modifications, server additions, and configuration changes."
        actions={
          <Button
            variant="outline"
            onClick={() => setConfirmClear(true)}
            disabled={activities.length === 0}
            aria-label="Clear operational log"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Clear Log
          </Button>
        }
      />

      <div className="rounded-xl border border-border bg-card">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <p className="font-semibold">The audit trail is empty</p>
            <p className="text-sm text-muted-foreground">
              Console actions will be recorded here as they happen.
            </p>
          </div>
        ) : (
          <ul className="scrollbar-thin max-h-[65vh] divide-y divide-border overflow-y-auto">
            {activities.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <span className="text-sm leading-relaxed">{a.text}</span>
                <time
                  dateTime={a.timestamp}
                  className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
                  title={new Date(a.timestamp).toISOString()}
                >
                  {formatDistanceToNowStrict(new Date(a.timestamp), { addSuffix: true })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear the operational log?"
        description="All recorded audit entries will be permanently removed."
        confirmLabel="Clear Log"
        destructive
        onConfirm={() => void clearActivities()}
      />
    </section>
  );
}
