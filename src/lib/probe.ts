// Server-only TCP probing library. Imported exclusively by API routes.

import net from "node:net";

export interface ProbeResult {
  status: "online" | "degraded" | "offline";
  latency: number | null; // ms
}

export function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    if (!host || typeof port !== "number" || port < 1 || port > 65535) {
      resolve({ status: "offline", latency: null });
      return;
    }
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (status: ProbeResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        status,
        latency: status === "offline" ? null : Date.now() - started,
      });
    };

    const timer = setTimeout(() => finish("offline"), timeoutMs);

    socket.once("connect", () => {
      const ms = Date.now() - started;
      finish(ms <= 150 ? "online" : "degraded");
    });
    socket.once("timeout", () => finish("offline"));
    socket.once("error", () => finish("offline"));
    socket.connect(port, host);
  });
}
