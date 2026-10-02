import { DEFAULT_CONFIG, type LimiterConfig, type TrafficSettings } from "./types";

export interface Scenario {
  id: string;
  title: string;
  description: string;
  expect: string;
  limiter2?: "up" | "down";
  redis?: "up" | "down";
  config: LimiterConfig;
  traffic: Omit<TrafficSettings, "client">;
}

const burst = { clients: 1, requests: 30, concurrency: 1, delayMs: 0 };

export const SCENARIOS: Scenario[] = [
  {
    id: "single",
    title: "One limiter, one truth",
    description: "A single replica with in-memory counters.",
    expect: "Exactly 10 allowed, 20 denied.",
    limiter2: "down",
    redis: "up",
    config: { ...DEFAULT_CONFIG, redisEnabled: false },
    traffic: burst,
  },
  {
    id: "race",
    title: "The race: two private counters",
    description: "Add a second replica, each still counting in its own memory.",
    expect: "About 20 allowed. Each replica happily allows its own 10.",
    limiter2: "up",
    redis: "up",
    config: { ...DEFAULT_CONFIG, redisEnabled: false },
    traffic: burst,
  },
  {
    id: "fix",
    title: "The fix: one shared counter",
    description: "Both replicas count atomically in Redis.",
    expect: "Back to exactly 10 allowed across both replicas.",
    limiter2: "up",
    redis: "up",
    config: { ...DEFAULT_CONFIG, redisEnabled: true },
    traffic: { ...burst, concurrency: 10 },
  },
  {
    id: "fail-open",
    title: "Redis dies: fail open",
    description: "Stop Redis while the limiters depend on it.",
    expect: "All 30 allowed, uncounted. The API stays up, unprotected.",
    limiter2: "up",
    redis: "down",
    config: { ...DEFAULT_CONFIG, redisEnabled: true, failMode: "open" },
    traffic: burst,
  },
  {
    id: "fail-closed",
    title: "Redis dies: fail closed",
    description: "Same outage, but the limiter refuses when it can't count.",
    expect: "All 30 rejected with 503. Protected, but fully down.",
    limiter2: "up",
    redis: "down",
    config: { ...DEFAULT_CONFIG, redisEnabled: true, failMode: "closed" },
    traffic: burst,
  },
  {
    id: "token-bucket",
    title: "Token bucket: burst, then drip",
    description: "10 tokens, refilling at 1/s. Requests arrive every 250 ms for 10 s.",
    expect: "A burst of 10, then roughly every 4th request passes (~20 total).",
    limiter2: "up",
    redis: "up",
    config: { ...DEFAULT_CONFIG, algorithm: "token-bucket", windowSeconds: 10 },
    traffic: { clients: 1, requests: 40, concurrency: 1, delayMs: 250 },
  },
];
