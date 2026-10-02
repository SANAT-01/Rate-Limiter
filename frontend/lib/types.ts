export const ALGORITHMS = [
  {
    id: "fixed-window",
    name: "Fixed window",
    summary: "One counter per calendar window, reset at the boundary.",
    tradeoff: "One INCR per request. Allows up to 2× the limit across a boundary.",
  },
  {
    id: "sliding-log",
    name: "Sliding log",
    summary: "Keeps every request timestamp; exact rolling window.",
    tradeoff: "Exact, no boundary burst, but stores one entry per request.",
  },
  {
    id: "sliding-window",
    name: "Sliding window counter",
    summary: "Current window + weighted share of the previous one.",
    tradeoff: "Near-exact with two counters per client. Common in gateways.",
  },
  {
    id: "token-bucket",
    name: "Token bucket",
    summary: "A bucket of tokens that refills steadily over the window.",
    tradeoff: "Permits a full burst up front, then a steady drip.",
  },
] as const;

export type Algorithm = (typeof ALGORITHMS)[number]["id"];
export type FailMode = "open" | "closed";

export interface LimiterConfig {
  algorithm: Algorithm;
  limit: number;
  windowSeconds: number;
  redisEnabled: boolean;
  failMode: FailMode;
}

export interface LimiterStats {
  allowed: number;
  denied: number;
  failedOpen: number;
  failedClosed: number;
  since: string;
}

export interface LimiterInfo {
  name: string;
  online: boolean;
  config?: LimiterConfig;
  stats?: LimiterStats;
  error?: string;
}

export interface ServiceStatus {
  service: string;
  state: string;
  health: string | null;
}

export type ControlAction = "limiter2-up" | "limiter2-down" | "redis-start" | "redis-stop";

export interface TrafficSettings {
  client: string;
  clients: number;
  requests: number;
  concurrency: number;
  delayMs: number;
}

export interface HammerEntry {
  i: number;
  t: number;
  latencyMs: number;
  client: string;
  status: number | null;
  limiter: string | null;
  remaining: number | null;
  retryAfter: number | null;
  algorithm: string | null;
  backend: string | null;
  error?: string;
}

export const DEFAULT_CONFIG: LimiterConfig = {
  algorithm: "fixed-window",
  limit: 10,
  windowSeconds: 60,
  redisEnabled: true,
  failMode: "open",
};

export function sameConfig(a?: LimiterConfig, b?: LimiterConfig): boolean {
  if (!a || !b) return false;
  return (
    a.algorithm === b.algorithm &&
    a.limit === b.limit &&
    a.windowSeconds === b.windowSeconds &&
    a.redisEnabled === b.redisEnabled &&
    a.failMode === b.failMode
  );
}
