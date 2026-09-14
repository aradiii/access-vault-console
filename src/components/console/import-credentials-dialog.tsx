"use client";

import * as React from "react";
import { ClipboardPaste, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useConsoleStore } from "@/lib/store";

// Client-side approximate validation for the live preview. The server
// re-parses with the authoritative parser on submit.
const LINE_RE = /^[^@;\s]+(?::\d{1,5})?@[^\\/\s]+[\\/][^;\s]+;.+/;

export function ImportCredentialsDialog() {
  const open = useConsoleStore((s) => s.importDialogOpen);
  const setImportDialogOpen = useConsoleStore((s) => s.setImportDialogOpen);

  return (
    <Dialog open={open} onOpenChange={setImportDialogOpen}>
      {open && (
        <DialogContent className="max-w-xl" aria-describedby={undefined}>
          <ImportForm />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ImportForm() {
  const setImportDialogOpen = useConsoleStore((s) => s.setImportDialogOpen);
  const importCredentials = useConsoleStore((s) => s.importCredentials);

  const [text, setText] = React.useState("");
  const [mode, setMode] = React.useState<"append" | "replace">("append");
  const [importing, setImporting] = React.useState(false);

  const lines = React.useMemo(
    () => text.split(/\r?\n/).filter((l) => l.trim().length > 0),
    [text]
  );
  const valid = React.useMemo(() => lines.filter((l) => LINE_RE.test(l.trim())).length, [lines]);
  const invalid = lines.length - valid;

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText((prev) => (prev.trim() ? prev.replace(/\s*$/, "\n") + content : content));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (valid === 0) return;
    setImporting(true);
    const ok = await importCredentials(text, mode);
    setImporting(false);
    if (ok) setImportDialogOpen(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileUp className="h-4 w-4 text-primary" aria-hidden="true" />
          Import Credentials
        </DialogTitle>
        <DialogDescription>
          Paste lines in the standard exchange format:
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            host:port@DOMAIN\username;password
          </code>
          — port may be omitted (defaults to 3389).
        </DialogDescription>
      </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="import-text">Credential list</Label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
                Load from .txt file
                <input
                  type="file"
                  accept=".txt,.csv,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    void handleFile(e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <Textarea
              id="import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "192.0.2.10:3389@fabrikam\\azureadmin;ExamplePass1!\n203.0.113.10@EXAMPLE\\vmadmin;ExamplePass2!"
              }
              rows={7}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-4 text-xs" aria-live="polite">
              <span className={cn("font-medium", valid > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                {valid} valid line{valid === 1 ? "" : "s"}
              </span>
              {invalid > 0 && (
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {invalid} unrecognized line{invalid === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Import mode</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "append" | "replace")}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <label
                className={cn(
                  "flex flex-1 cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                  mode === "append" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
                )}
              >
                <RadioGroupItem value="append" id="mode-append" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">Append</span>
                  <span className="block text-xs text-muted-foreground">Add to the existing vault entries.</span>
                </span>
              </label>
              <label
                className={cn(
                  "flex flex-1 cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                  mode === "replace" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
                )}
              >
                <RadioGroupItem value="replace" id="mode-replace" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium text-red-600 dark:text-red-400">Replace all</span>
                  <span className="block text-xs text-muted-foreground">Wipe the vault, then import.</span>
                </span>
              </label>
            </RadioGroup>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={importing || valid === 0}>
              {importing ? "Importing..." : `Import ${valid || ""} ${valid === 1 ? "Entry" : "Entries"}`.trim()}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}
