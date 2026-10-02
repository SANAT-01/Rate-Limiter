'use strict';

// Every algorithm has two implementations with identical semantics:
//   local(client, cfg, now)        — in-process Map, private to this replica
//   redis(call, client, cfg, now)  — one atomic Lua script, shared by all replicas
// Both resolve to { allowed, used, remaining, retryAfterMs }.
//
// The Lua scripts make check-and-update a single atomic step inside Redis, so two
// replicas deciding at the same instant can never both take the last slot.

// ------------------------------- local state -----------------------------------
const localState = new Map();
let lastSweep = 0;

function touch(key, now, ttlMs, init) {
  if (now - lastSweep > 30_000) {
    lastSweep = now;
    for (const [k, s] of localState) if (s.expiresAt <= now) localState.delete(k);
  }
  let s = localState.get(key);
  if (!s) {
    s = init();
    localState.set(key, s);
  }
  s.expiresAt = now + ttlMs;
  return s;
}

function resetLocal() {
  localState.clear();
}

// -------------------------------- fixed window ---------------------------------
const FIXED_WINDOW_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

function fixedResult(n, limit, msToWindowEnd) {
  const allowed = n <= limit;
  return { allowed, used: n, remaining: Math.max(0, limit - n), retryAfterMs: allowed ? 0 : msToWindowEnd };
}

const fixedWindow = {
  local(client, cfg, now) {
    const win = cfg.windowSeconds * 1000;
    const idx = Math.floor(now / win);
    const s = touch(`fw:${client}:${idx}`, now, win * 2, () => ({ n: 0 }));
    s.n += 1;
    return fixedResult(s.n, cfg.limit, win - (now % win));
  },
  async redis(call, client, cfg, now) {
    const win = cfg.windowSeconds * 1000;
    const idx = Math.floor(now / win);
    const n = await call('EVAL', FIXED_WINDOW_LUA, 1, `rate:${client}:${idx}`, cfg.windowSeconds * 2);
    return fixedResult(n, cfg.limit, win - (now % win));
  },
};

// -------------------------------- sliding log ----------------------------------
const SLIDING_LOG_LUA = `
local now, win, limit = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - win)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], win)
  return {1, count + 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {0, count, tonumber(oldest[2]) + win - now}`;

const slidingLog = {
  local(client, cfg, now) {
    const win = cfg.windowSeconds * 1000;
    const s = touch(`sl:${client}`, now, win, () => ({ ts: [] }));
    while (s.ts.length && s.ts[0] <= now - win) s.ts.shift();
    if (s.ts.length < cfg.limit) {
      s.ts.push(now);
      return { allowed: true, used: s.ts.length, remaining: cfg.limit - s.ts.length, retryAfterMs: 0 };
    }
    return { allowed: false, used: s.ts.length, remaining: 0, retryAfterMs: s.ts[0] + win - now };
  },
  async redis(call, client, cfg, now) {
    const win = cfg.windowSeconds * 1000;
    const member = `${now}-${Math.random().toString(36).slice(2)}`;
    const [allowed, count, retry] = await call('EVAL', SLIDING_LOG_LUA, 1, `rate:sl:${client}`, now, win, cfg.limit, member);
    return { allowed: allowed === 1, used: count, remaining: Math.max(0, cfg.limit - count), retryAfterMs: retry };
  },
};

// --------------------------- sliding window counter ----------------------------
// Estimate = previous window's count weighted by how much of it still overlaps
// the rolling window, plus the current window's count.
const SLIDING_WINDOW_LUA = `
local curr = tonumber(redis.call('GET', KEYS[1]) or '0')
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
local limit, win, elapsed = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
if prev * (win - elapsed) / win + curr + 1 <= limit then
  redis.call('INCR', KEYS[1])
  redis.call('PEXPIRE', KEYS[1], win * 2)
  return {1, prev, curr}
end
return {0, prev, curr}`;

function slidingDecision(allowed, prev, currBefore, limit, win, elapsed) {
  const estimate = (prev * (win - elapsed)) / win + currBefore;
  if (allowed) {
    const used = estimate + 1;
    return { allowed, used: Math.ceil(used), remaining: Math.max(0, Math.floor(limit - used)), retryAfterMs: 0 };
  }
  // When will the weighted previous window have decayed enough to fit one more?
  const retryAfterMs = currBefore + 1 > limit
    ? win - elapsed
    : Math.ceil(win - ((limit - 1 - currBefore) * win) / prev - elapsed);
  return { allowed, used: Math.ceil(estimate), remaining: 0, retryAfterMs: Math.max(1, retryAfterMs) };
}

const slidingWindow = {
  local(client, cfg, now) {
    const win = cfg.windowSeconds * 1000;
    const idx = Math.floor(now / win);
    const elapsed = now - idx * win;
    const curr = touch(`sw:${client}:${idx}`, now, win * 2, () => ({ n: 0 }));
    const prev = localState.get(`sw:${client}:${idx - 1}`)?.n ?? 0;
    const allowed = (prev * (win - elapsed)) / win + curr.n + 1 <= cfg.limit;
    const result = slidingDecision(allowed, prev, curr.n, cfg.limit, win, elapsed);
    if (allowed) curr.n += 1;
    return result;
  },
  async redis(call, client, cfg, now) {
    const win = cfg.windowSeconds * 1000;
    const idx = Math.floor(now / win);
    const elapsed = now - idx * win;
    const [allowed, prev, curr] = await call(
      'EVAL', SLIDING_WINDOW_LUA, 2,
      `rate:sw:${client}:${idx}`, `rate:sw:${client}:${idx - 1}`,
      cfg.limit, win, elapsed
    );
    return slidingDecision(allowed === 1, prev, curr, cfg.limit, win, elapsed);
  },
};

// -------------------------------- token bucket ---------------------------------
// Capacity = limit tokens; refills continuously at limit / window.
const TOKEN_BUCKET_LUA = `
local now, cap, rate = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens, ts = tonumber(data[1]), tonumber(data[2])
if tokens == nil then tokens, ts = cap, now end
tokens = math.min(cap, tokens + math.max(0, now - ts) * rate)
local allowed, retry = 0, 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', math.max(ts, now))
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate) * 2)
return {allowed, math.floor(tokens), retry}`;

const tokenBucket = {
  local(client, cfg, now) {
    const cap = cfg.limit;
    const rate = cfg.limit / (cfg.windowSeconds * 1000);
    const s = touch(`tb:${client}`, now, cfg.windowSeconds * 2000, () => ({ tokens: cap, ts: now }));
    s.tokens = Math.min(cap, s.tokens + Math.max(0, now - s.ts) * rate);
    s.ts = Math.max(s.ts, now);
    if (s.tokens >= 1) {
      s.tokens -= 1;
      const remaining = Math.floor(s.tokens);
      return { allowed: true, used: cap - remaining, remaining, retryAfterMs: 0 };
    }
    return { allowed: false, used: cap, remaining: 0, retryAfterMs: Math.ceil((1 - s.tokens) / rate) };
  },
  async redis(call, client, cfg, now) {
    const rate = cfg.limit / (cfg.windowSeconds * 1000);
    const [allowed, remaining, retry] = await call('EVAL', TOKEN_BUCKET_LUA, 1, `rate:tb:${client}`, now, cfg.limit, rate);
    return { allowed: allowed === 1, used: cfg.limit - remaining, remaining, retryAfterMs: retry };
  },
};

const ALGORITHM_IMPLS = {
  'fixed-window': fixedWindow,
  'sliding-log': slidingLog,
  'sliding-window': slidingWindow,
  'token-bucket': tokenBucket,
};

module.exports = { ALGORITHM_IMPLS, resetLocal };
