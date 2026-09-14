"use client";

import * as React from "react";
import { Activity, Gauge, Server, TimerOff, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { computeMetrics, useConsoleStore } from "@/lib/store";

interface Metric {
  key: string;
  label: string;
  value: string;
  icon: React.ElementType;
  // Small semantic dot next to the label — the value itself stays neutral.
  dotClass?: string;
}

export function MetricsGrid() {
  const credentials = useConsoleStore((s) => s.credentials);
  const m = React.useMemo(() => computeMetrics(credentials), [credentials]);

  const metrics: Metric[] = [
    { key: "total", label: "Total Servers", value: String(m.total), icon: Server },
    { key: "online", label: "Online Nodes", value: String(m.online), icon: Activity, dotClass: "bg-emerald-500" },
    { key: "degraded", label: "Degraded (High Latency)", value: String(m.degraded), icon: Gauge, dotClass: "bg-amber-500" },
    { key: "offline", label: "Offline / Unreachable", value: String(m.offline), icon: WifiOff, dotClass: "bg-red-500" },
    { key: "latency", label: "Average Fleet Latency", value: m.avgLatency != null ? `${m.avgLatency} ms` : "-- ms", icon: TimerOff },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.key} className="shadow-sm">
            <CardContent className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                  {metric.dotClass && (
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", metric.dotClass)}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{metric.label}</span>
                </span>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              </div>
              <div className="text-2xl font-semibold tabular-nums leading-none tracking-tight text-foreground">
                {metric.value}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
