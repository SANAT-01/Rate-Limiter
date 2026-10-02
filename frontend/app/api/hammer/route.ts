import http from "node:http";
import { NextRequest } from "next/server";
import type { HammerEntry } from "@/lib/types";

// Parsed once: host/port for plain http.request rather than fetch(). Node's
// fetch (undici) has known DNS/connect hangs resolving container hostnames
// under Alpine/musl in Docker; http.request doesn't hit that path.
const LB = new URL(process.env.LB_URL || "http://localhost:8090");
const LB_HOST = LB.hostname;
const LB_PORT = Number(LB.port) || (LB.protocol === "https:" ? 443 : 80);
const REQUEST_TIMEOUT_MS = 5000;
const MAX_RUN_MS = 120_000;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function headerStr(headers: http.IncomingHttpHeaders, name: string): string | null {
  const v = headers[name];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? null : null;
}

function headerNum(headers: http.IncomingHttpHeaders, name: string): number | null {
  const v = headerStr(headers, name);
  return v === null ? null : Number(v);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

function sendRequest(client: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: LB_HOST,
        port: LB_PORT,
        path: "/",
        method: "GET",
        headers: { "X-Client": client },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        res.on("data", () => {}); // drain the body; we only need status + headers
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end();
  });
}

// Streams one NDJSON line per request as it completes, so the dashboard can draw
// results live. Batches of `concurrency` requests fire in parallel; `delayMs`
// pauses between batches (to watch windows roll over and buckets refill).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const requests = clampInt(body.requests, 1, 1000, 30);
  const concurrency = clampInt(body.concurrency, 1, 50, 1);
  const clientCount = clampInt(body.clients, 1, 50, 1);
  const batches = Math.ceil(requests / concurrency);
  const delayMs = Math.min(clampInt(body.delayMs, 0, 5000, 0), Math.floor(MAX_RUN_MS / batches));
  const prefix =
    typeof body.client === "string" && body.client.trim()
      ? body.client.trim().slice(0, 64)
      : `client-${Date.now()}`;
  const clients =
    clientCount === 1 ? [prefix] : Array.from({ length: clientCount }, (_, i) => `${prefix}-${i + 1}`);

  const signal = request.signal;
  const encoder = new TextEncoder();
  const start = Date.now();

  async function fire(i: number, client: string): Promise<HammerEntry> {
    const sent = Date.now();
    try {
      const { status, headers } = await sendRequest(client);
      return {
        i,
        t: sent - start,
        latencyMs: Date.now() - sent,
        client,
        status,
        limiter: headerStr(headers, "x-limiter"),
        remaining: headerNum(headers, "x-ratelimit-remaining"),
        retryAfter: headerNum(headers, "retry-after"),
        algorithm: headerStr(headers, "x-ratelimit-algorithm"),
        backend: headerStr(headers, "x-ratelimit-backend"),
      };
    } catch (err) {
      return {
        i,
        t: sent - start,
        latencyMs: Date.now() - sent,
        client,
        status: null,
        limiter: null,
        remaining: null,
        retryAfter: null,
        algorithm: null,
        backend: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {}
      };
      let i = 0;
      while (i < requests && !signal.aborted) {
        const batch: Promise<HammerEntry>[] = [];
        for (let k = 0; k < concurrency && i < requests; k++, i++) {
          batch.push(fire(i, clients[i % clients.length]).then((e) => (send(e), e)));
        }
        await Promise.all(batch);
        if (delayMs && i < requests) await sleep(delayMs, signal);
      }
      send({ done: true, durationMs: Date.now() - start, delayMs });
      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
