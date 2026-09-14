"use client";

import * as React from "react";

// PageHeader — a restrained, enterprise-style page heading:
// uppercase kicker, semibold title, muted description, optional
// right-aligned actions/meta slot. Replaces the old heavy "hero card".
export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {kicker}
        </p>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-[22px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0 sm:pb-0.5">{actions}</div>}
    </header>
  );
}
