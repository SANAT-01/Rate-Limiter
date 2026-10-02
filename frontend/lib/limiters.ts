import http from "node:http";
import type { LimiterConfig, LimiterInfo } from "./types";

// Limiter admin APIs, reached directly on the compose network (nginx blocks /admin).
export const LIMITERS = ["limiter1", "limiter2"] as const;

// Plain http.request rather than fetch(): Node's fetch (undici) has known
// DNS/connect hangs resolving container hostnames under Alpine/musl in Docker —
// http.request doesn't hit that path, and it's what the limiter's own
// request-forwarding already uses reliably.
function request<T>(name: string, path: string, options: { method?: string; body?: string } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: name,
        port: 9000,
        path,
        method: options.method || "GET",
        timeout: 2000,
        headers: options.body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(options.body) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          } catch {
            // non-JSON body; fall through with an empty object
          }
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) resolve(body as T);
          else reject(new Error(typeof body.error === "string" ? body.error : `HTTP ${status}`));
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function get<T>(name: string, path: string): Promise<T> {
  return request<T>(name, path);
}

function post(name: string, path: string, body: unknown) {
  return request(name, path, { method: "POST", body: JSON.stringify(body) });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getLimiter(name: string): Promise<LimiterInfo> {
  try {
    const [config, stats] = await Promise.all([
      get<LimiterInfo["config"]>(name, "/admin/config"),
      get<LimiterInfo["stats"]>(name, "/admin/stats"),
    ]);
    return { name, online: true, config, stats };
  } catch (err) {
    return { name, online: false, error: message(err) };
  }
}

export function getLimiters(): Promise<LimiterInfo[]> {
  return Promise.all(LIMITERS.map(getLimiter));
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
