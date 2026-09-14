"use client";

import * as React from "react";
import { Menu, Plus, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useConsoleStore } from "@/lib/store";
import { ConsoleSidebarContent } from "./console-sidebar";

export function ConsoleHeader() {
  const probing = useConsoleStore((s) => s.probing);
  const mobileNavOpen = useConsoleStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useConsoleStore((s) => s.setMobileNavOpen);
  const setCredDialogOpen = useConsoleStore((s) => s.setCredDialogOpen);
  const probeFleet = useConsoleStore((s) => s.probeFleet);

  return (
    <header className="sticky top-0 z-30 flex h-auto min-h-[64px] flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6 lg:flex-nowrap lg:py-0">
      <div className="flex min-w-0 items-center gap-3">
        {/* Mobile nav trigger */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0" aria-label="Main Navigation">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <ConsoleSidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <span
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
          aria-label="Live monitoring mode"
        >
          <span className="ops-pulse h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Live
        </span>

        <span className="hidden truncate text-xs text-muted-foreground xl:inline">
          Real TCP probes · Fleet synced with the Access Vault
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => void probeFleet()}
          disabled={probing}
          aria-label="Probe all servers immediately"
        >
          <Radar className={probing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
          <span>{probing ? "Probing..." : "Probe Now"}</span>
        </Button>
        <Button onClick={() => setCredDialogOpen(true)} aria-label="Add new server">
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Add Server</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>
    </header>
  );
}
