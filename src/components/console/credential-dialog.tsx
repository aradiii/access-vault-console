"use client";

import * as React from "react";
import { Cpu, Eye, EyeOff, KeyRound, MemoryStick } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsoleStore } from "@/lib/store";
import type { CredentialDTO } from "@/lib/console-types";

interface FormState {
  host: string;
  port: string;
  domain: string;
  username: string;
  password: string;
  notes: string;
  cores: string;
  ramGb: string;
}

function toFormState(c: CredentialDTO | null): FormState {
  if (!c) {
    return { host: "", port: "3389", domain: "", username: "", password: "", notes: "", cores: "", ramGb: "" };
  }
  return {
    host: c.host,
    port: String(c.port),
    domain: c.domain,
    username: c.username,
    password: c.password,
    notes: c.notes ?? "",
    cores: c.cores != null ? String(c.cores) : "",
    ramGb: c.ramGb != null ? String(c.ramGb) : "",
  };
}

export function CredentialDialog() {
  const open = useConsoleStore((s) => s.credDialogOpen);
  const editingId = useConsoleStore((s) => s.editingCredentialId);
  const credentials = useConsoleStore((s) => s.credentials);
  const setCredDialogOpen = useConsoleStore((s) => s.setCredDialogOpen);

  const editing = React.useMemo(
    () => credentials.find((c) => c.id === editingId) ?? null,
    [credentials, editingId]
  );

  return (
    <Dialog open={open} onOpenChange={setCredDialogOpen}>
      {/* key remounts the form whenever the target entry changes, so state
          resets naturally when Radix unmounts the content on close */}
      {open && (
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <CredentialForm key={editingId ?? "new"} editing={editing} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function CredentialForm({
  editing,
}: {
  editing: CredentialDTO | null;
}) {
  const setCredDialogOpen = useConsoleStore((s) => s.setCredDialogOpen);
  const addCredential = useConsoleStore((s) => s.addCredential);
  const updateCredential = useConsoleStore((s) => s.updateCredential);

  const [form, setForm] = React.useState<FormState>(() => toFormState(editing));
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const setField = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const validate = (): string | null => {
    const host = form.host.trim();
    const domain = form.domain.trim();
    const username = form.username.trim();
    const port = Number(form.port);
    if (!host) return "Host / IP address is required.";
    if (!/^[a-zA-Z0-9.\-_]+$/.test(host))
      return "Host may only contain letters, digits, dots, dashes and underscores.";
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return "Port must be an integer between 1 and 65535.";
    if (!domain) return "Domain is required.";
    if (!username) return "Username is required.";
    if (!form.password) return "Password is required.";
    if (form.cores !== "") {
      const cores = Number(form.cores);
      if (!Number.isInteger(cores) || cores < 1 || cores > 4096)
        return "CPU cores must be an integer between 1 and 4096.";
    }
    if (form.ramGb !== "") {
      const ram = Number(form.ramGb);
      if (!Number.isInteger(ram) || ram < 1 || ram > 65536)
        return "RAM (GB) must be an integer between 1 and 65536.";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    const payload = {
      host: form.host.trim(),
      port: Number(form.port),
      domain: form.domain.trim(),
      username: form.username.trim(),
      password: form.password,
      notes: form.notes.trim(),
      cores: form.cores === "" ? null : Number(form.cores),
      ramGb: form.ramGb === "" ? null : Number(form.ramGb),
    };
    const ok = editing
      ? await updateCredential(editing.id, payload)
      : await addCredential(payload);
    setSaving(false);
    if (ok) setCredDialogOpen(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
          {editing ? "Edit Vault Entry" : "Add Vault Entry"}
        </DialogTitle>
        <DialogDescription>
          Store connection details and hardware specs. Passwords stay masked in
          the table; every change is recorded in the operational log.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="cred-host">Host / IP *</Label>
            <Input
              id="cred-host"
              value={form.host}
              onChange={(e) => setField({ host: e.target.value })}
              placeholder="192.0.2.10"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-port">Port *</Label>
            <Input
              id="cred-port"
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) => setField({ port: e.target.value })}
              placeholder="3389"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-domain">Domain *</Label>
            <Input
              id="cred-domain"
              value={form.domain}
              onChange={(e) => setField({ domain: e.target.value })}
              placeholder="CONTOSO"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cred-username">Username *</Label>
            <Input
              id="cred-username"
              value={form.username}
              onChange={(e) => setField({ username: e.target.value })}
              placeholder="vmadmin"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cred-password">Password *</Label>
          <div className="relative">
            <Input
              id="cred-password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => setField({ password: e.target.value })}
              placeholder="••••••••••"
              autoComplete="new-password"
              className="pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Hardware specs */}
        <div>
          <Label className="mb-1.5 block">Hardware Specs (optional)</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <Cpu className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="cred-cores"
                type="number"
                min={1}
                max={4096}
                value={form.cores}
                onChange={(e) => setField({ cores: e.target.value })}
                placeholder="vCPU cores"
                aria-label="CPU cores"
                className="pl-9"
              />
            </div>
            <div className="relative">
              <MemoryStick className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="cred-ram"
                type="number"
                min={1}
                max={65536}
                value={form.ramGb}
                onChange={(e) => setField({ ramGb: e.target.value })}
                placeholder="RAM in GB"
                aria-label="RAM in GB"
                className="pl-9"
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Leave empty if unknown — fleet totals count only defined entries.
          </p>
          {editing?.osVersion && (
            <p className="mt-1 rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              Auto-detected: <span className="font-medium text-foreground">{editing.osName ?? "Windows"}</span>{" "}
              ({editing.osVersion})
              {editing.computerName ? ` · ${editing.computerName}` : ""}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cred-notes">Notes</Label>
          <Input
            id="cred-notes"
            value={form.notes}
            onChange={(e) => setField({ notes: e.target.value })}
            placeholder="Optional label, e.g. Azure VM - production"
            maxLength={200}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setCredDialogOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : editing ? "Save Changes" : "Add Entry"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
