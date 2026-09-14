# Access Vault — Remote Desktop Operations Console

A production-style operations console for managing a fleet of Windows servers over RDP.
Built with **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui + Prisma (SQLite) + Zustand**.

![Status](https://img.shields.io/badge/status-live--demo-brightgreen) ![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%2B%20TypeScript-blue)

## Features

- **Fleet Overview** — live dashboard of every server in the vault: real TCP port-3389 reachability probes, latency, CPU cores / RAM / OS details, auto-refresh with countdown.
- **Access Vault** — credential manager. Paste raw `host:port@DOMAIN\user;password` lines (bulk or per-field) and every entry is validated, probed, and deployed to the dashboard.
- **Real RDP Sessions** — one-click live desktop via an `xfreerdp → x11vnc → noVNC` bridge (separate mini-service), with a floating in-session toolbar: Ctrl+Alt+Del, fullscreen, professional keys & text-paste tools, disconnect.
- **Operational Activity** — append-only log of probes, imports, and session events.
- **Settings & Backend** — probe cadence, health endpoints, agent deployment script (`public/agent/agent.ps1`).
- **Offline HTML Snapshot** — one-click `Export HTML` produces a fully self-contained static copy of the console (in-page Blob download with fallbacks).

## Architecture

```
┌────────────────────────────┐      ┌──────────────────────────────┐
│  Next.js 16 console (:3000)│      │  rdp-bridge mini-service     │
│  App Router + Zustand      │──────▶  (:3010, Bun + xfreerdp)     │
│  API routes + Prisma/SQLite│  ws  │  x11vnc ─▶ noVNC in browser  │
└────────────────────────────┘      └──────────────────────────────┘
```

| Route | Purpose |
|---|---|
| `POST /api/credentials` | bulk import `host:port@DOMAIN\user;password` |
| `POST /api/rdp/monitor` | TCP probe sweep, updates status/latency/specs |
| `POST /api/rdp/sessions` | start RDP session (bridge spawns xfreerdp) |
| `GET /api/download-html` | static snapshot download |
| `GET /api/health` | liveness probe |

## Getting Started

```bash
bun install
bun run db:push        # create SQLite schema
bun run dev            # http://localhost:3000
```

RDP bridge (separate terminal):

```bash
cd mini-services/rdp-bridge
bun install && bun run dev    # :3010
```

> The RDP bridge requires a Linux host with `xfreerdp` and `x11vnc` installed.

## Security Notes

- ⚠️ The SQLite database stores credentials in **plaintext** by design (internal ops tool). Keep the repository **private** and never commit a database containing real credentials to a public remote.
- Static HTML snapshots embed fleet metadata (IPs, usernames; passwords are masked) — treat exported snapshots as sensitive.

## License

Private / internal use.
