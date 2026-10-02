import { NextRequest } from "next/server";
import type { HammerEntry } from "@/lib/types";

const LB_URL = process.env.LB_URL || "http://localhost:8090";
const MAX_RUN_MS = 120_000;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function numHeader(res: Response, name: string): number | null {
  const v = res.headers.get(name);
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
      const res = await fetch(`${LB_URL}/`, { headers: { "X-Client": client }, cache: "no-store" });
      await res.arrayBuffer();
      return {
        i,
        t: sent - start,
        latencyMs: Date.now() - sent,
        client,
        status: res.status,
        limiter: res.headers.get("x-limiter"),
        remaining: numHeader(res, "x-ratelimit-remaining"),
        retryAfter: numHeader(res, "retry-after"),
        algorithm: res.headers.get("x-ratelimit-algorithm"),
        backend: res.headers.get("x-ratelimit-backend"),
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
