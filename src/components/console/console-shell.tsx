"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useConsoleStore } from "@/lib/store";
import { setThemeBridge } from "@/lib/theme-bridge";
import { ConsoleSidebarContent } from "./console-sidebar";
import { ConsoleHeader } from "./console-header";
import { DashboardView } from "./dashboard-view";
import { VaultView } from "./vault-view";
import { ActivityView } from "./activity-view";
import { SettingsView } from "./settings-view";
import { CredentialDialog } from "./credential-dialog";
import { ImportCredentialsDialog } from "./import-credentials-dialog";
import { SessionDialog } from "./session-dialog";
import { AgentDialog } from "./agent-dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function ConsoleShell() {
  const booted = useConsoleStore((s) => s.booted);
  const activeTab = useConsoleStore((s) => s.activeTab);
  const bootstrap = useConsoleStore((s) => s.bootstrap);
  const tick = useConsoleStore((s) => s.tick);
  const { setTheme } = useTheme();

  // Bridge next-themes into the store so settings changes apply instantly
  React.useEffect(() => {
    setThemeBridge(setTheme);
    return () => setThemeBridge(null);
  }, [setTheme]);

  // Bootstrap data once
  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Auto-probe countdown (1s heartbeat)
  React.useEffect(() => {
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [tick]);

  // Escape closes the details panel
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const store = useConsoleStore.getState();
        if (store.credDialogOpen || store.importDialogOpen) return; // dialogs handle themselves
        if (store.selectedId) store.selectServer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        className="hidden w-[260px] shrink-0 border-r border-sidebar-border lg:block"
        aria-label="Main Navigation"
      >
        <ConsoleSidebarContent />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ConsoleHeader />

        <main className="scrollbar-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] p-4 sm:p-7">
            {!booted ? (
              <BootSkeleton />
            ) : (
              <>
                {activeTab === "dashboard" && <DashboardView />}
                {activeTab === "vault" && <VaultView />}
                {activeTab === "activity" && <ActivityView />}
                {activeTab === "settings" && <SettingsView />}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Global dialogs — available from every tab (header "Add Server" etc.) */}
      <CredentialDialog />
      <ImportCredentialsDialog />
      <SessionDialog />
      <AgentDialog />
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading console">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-t-xl" />
      <Skeleton className="h-72 w-full rounded-b-xl" />
    </div>
  );
}
