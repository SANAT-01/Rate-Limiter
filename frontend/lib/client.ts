import type { ControlAction, HammerEntry, LimiterConfig, TrafficSettings } from "./types";

async function postJson<T = { ok: boolean; error?: string }>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function expectOk(p: Promise<{ ok: boolean; error?: string }>) {
  const data = await p;
  if (!data.ok) throw new Error(data.error || "request failed");
  return data;
}

export const api = {
  control: (action: ControlAction) => expectOk(postJson("/api/control", { action })),
  applyConfig: (config: LimiterConfig) => expectOk(postJson("/api/limiters", { action: "config", config })),
  reset: () => expectOk(postJson("/api/limiters", { action: "reset" })),
};

export interface RunSummary {
  durationMs: number;
}

// Reads the NDJSON stream from /api/hammer, calling onEntry per request.
export async function streamTraffic(
  settings: TrafficSettings,
  signal: AbortSignal,
  onEntry: (e: HammerEntry) => void
): Promise<RunSummary> {
  const res = await fetch("/api/hammer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    signal,
  });
  if (!res.body) throw new Error("no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let summary: RunSummary = { durationMs: 0 };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.done) summary = { durationMs: msg.durationMs };
      else onEntry(msg as HammerEntry);
    }
  }
  return summary;
}

export function freshClientId(prefix = "user") {
  return `${prefix}-${Date.now().toString(36)}`;
}

export function summarize(entries: HammerEntry[]) {
  const s = { sent: entries.length, allowed: 0, denied: 0, unavailable: 0, errors: 0, avgLatency: 0 };
  const byLimiter: Record<string, { allowed: number; denied: number; other: number }> = {};
  let latency = 0;
  for (const e of entries) {
    latency += e.latencyMs;
    if (e.status === 200) s.allowed++;
    else if (e.status === 429) s.denied++;
    else if (e.status !== null) s.unavailable++;
    else s.errors++;
    if (e.limiter) {
      const b = (byLimiter[e.limiter] ??= { allowed: 0, denied: 0, other: 0 });
      if (e.status === 200) b.allowed++;
      else if (e.status === 429) b.denied++;
      else b.other++;
    }
  }
  s.avgLatency = entries.length ? Math.round(latency / entries.length) : 0;
  return { ...s, byLimiter };
}
