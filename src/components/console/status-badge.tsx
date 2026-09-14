"use client";

import { cn } from "@/lib/utils";
import type { EndpointStatus } from "@/lib/console-types";

// Professional status chip: soft tinted background, no loud border,
// a small dot plus a calm capitalized label. Color is used strictly
// as a semantic annotation.
const STATUS_STYLES: Record<EndpointStatus, string> = {
  online: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  degraded: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  offline: "bg-red-500/10 text-red-700 dark:text-red-400",
  unknown: "bg-muted text-muted-foreground",
};

const STATUS_DOT: Record<EndpointStatus, string> = {
  online: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-red-500",
  unknown: "bg-zinc-400 dark:bg-zinc-500",
};

export function StatusBadge({ status }: { status: EndpointStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium capitalize",
        STATUS_STYLES[status] ?? STATUS_STYLES.unknown
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status] ?? STATUS_DOT.unknown)}
        aria-hidden="true"
      />
      {status}
    </span>
  );
}
