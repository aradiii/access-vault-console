"use client";

import * as React from "react";

export function UtcClock({ className }: { className?: string }) {
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setNow(new Date()), 50);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, []);

  const text = now ? now.toISOString().slice(11, 19) + " UTC" : "--:--:-- UTC";

  return (
    <span className={className} aria-label="Current UTC time" suppressHydrationWarning>
      {text}
    </span>
  );
}
