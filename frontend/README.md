# Rate Limiter Lab — Dashboard

A Next.js dashboard for the Rate-Limit It lab (see the [repo root README](../README.md)
for the feature tour). `docker compose up -d --build` from the repo root runs it at
http://localhost:3000.

## Layout

- `app/page.tsx`: state, polling, and the scenario / comparison runners
- `app/components/`: UI panels (policy, infrastructure, traffic, comparison, logs), one CSS module
- `lib/scenarios.ts`: the guided-lab scenarios (edit this to add your own)
- `lib/types.ts`: shared types and algorithm descriptions

## API routes

- `api/limiters`: `GET` config + stats of each limiter; `POST {action: "config" | "reset"}` applies to all running replicas
- `api/hammer`: streams one NDJSON line per request (`requests`, `concurrency`, `delayMs`, `clients`)
- `api/control`: start/stop `limiter2` or `redis`; a restarted `limiter2` gets `limiter1`'s live config
- `api/status`, `api/logs`: container state and logs via the Docker Engine API (`/var/run/docker.sock`)
- `api/health`: liveness check

The limiter admin calls go straight to `limiter1:9000` / `limiter2:9000`, so the dashboard
must run on the compose network. `npm run dev` on the host works for the UI, but those calls fail there.
