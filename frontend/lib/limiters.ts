import type { LimiterConfig, LimiterInfo } from "./types";

// Limiter admin APIs, reached directly on the compose network (nginx blocks /admin).
export const LIMITERS = ["limiter1", "limiter2"] as const;

async function call<T>(name: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`http://${name}:9000${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(2000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getLimiter(name: string): Promise<LimiterInfo> {
  try {
    const [config, stats] = await Promise.all([
      call<LimiterInfo["config"]>(name, "/admin/config"),
      call<LimiterInfo["stats"]>(name, "/admin/stats"),
    ]);
    return { name, online: true, config, stats };
  } catch (err) {
    return { name, online: false, error: message(err) };
  }
}

export function getLimiters(): Promise<LimiterInfo[]> {
  return Promise.all(LIMITERS.map(getLimiter));
}

function post(name: string, path: string, body: unknown) {
  return call(name, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function onEach(fn: (name: string) => Promise<unknown>) {
  const online = (await getLimiters()).filter((l) => l.online);
  if (online.length === 0) throw new Error("no limiter is reachable");
  return Promise.all(
    online.map(async ({ name }) => {
      try {
        await fn(name);
        return { name, ok: true };
      } catch (err) {
        return { name, ok: false, error: message(err) };
      }
    })
  );
}

export function applyConfig(config: Partial<LimiterConfig>) {
  return onEach((name) => post(name, "/admin/config", config));
}

export function resetCounters() {
  return onEach((name) => post(name, "/admin/reset", {}));
}

// A replica that was just (re)started boots with env defaults; copy the live
// settings from another replica so both enforce the same policy.
export async function syncLimiter(target: string): Promise<boolean> {
  const source = LIMITERS.find((n) => n !== target);
  if (!source) return false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await getLimiter(target);
    if (info.online) {
      const from = await getLimiter(source);
      if (!from.online || !from.config) return false;
      const { algorithm, limit, windowSeconds, redisEnabled, failMode } = from.config;
      await post(target, "/admin/config", { algorithm, limit, windowSeconds, redisEnabled, failMode });
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
