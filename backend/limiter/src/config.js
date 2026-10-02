'use strict';

const os = require('os');

const ALGORITHMS = ['fixed-window', 'sliding-log', 'sliding-window', 'token-bucket'];
const FAIL_MODES = ['open', 'closed'];

function parsePositiveInt(v, def, name, errors) {
  const n = parseInt(v !== undefined ? v : def, 10);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push(`${name} must be a positive integer (got "${v}")`);
  }
  return n;
}

// Validates a partial set of runtime-tunable settings on top of `base`.
// Shared by env parsing at startup and the POST /admin/config endpoint.
function validateRuntime(input, base) {
  const errors = [];
  const out = { ...base };

  if (input.algorithm !== undefined) {
    if (ALGORITHMS.includes(input.algorithm)) out.algorithm = input.algorithm;
    else errors.push(`algorithm must be one of: ${ALGORITHMS.join(', ')}`);
  }
  if (input.limit !== undefined) {
    const n = Number(input.limit);
    if (Number.isInteger(n) && n >= 1 && n <= 10000) out.limit = n;
    else errors.push('limit must be an integer between 1 and 10000');
  }
  if (input.windowSeconds !== undefined) {
    const n = Number(input.windowSeconds);
    if (Number.isInteger(n) && n >= 1 && n <= 3600) out.windowSeconds = n;
    else errors.push('windowSeconds must be an integer between 1 and 3600');
  }
  if (input.redisEnabled !== undefined) {
    const v = typeof input.redisEnabled === 'string' ? input.redisEnabled.toLowerCase() : input.redisEnabled;
    if (v === true || v === 'true') out.redisEnabled = true;
    else if (v === false || v === 'false') out.redisEnabled = false;
    else errors.push('redisEnabled must be true or false');
  }
  if (input.failMode !== undefined) {
    const m = String(input.failMode).toLowerCase();
    if (FAIL_MODES.includes(m)) out.failMode = m;
    else errors.push('failMode must be "open" or "closed"');
  }

  return { value: out, errors };
}

const errors = [];

const config = {
  name: process.env.LIMITER_NAME || os.hostname(),
  port: parsePositiveInt(process.env.PORT, '9000', 'PORT', errors),
  redisHost: process.env.REDISHOST || 'redis',
  redisPort: parsePositiveInt(process.env.REDISPORT, '6379', 'REDISPORT', errors),
  apiHost: process.env.APIHOST || 'api',
  apiPort: parsePositiveInt(process.env.APIPORT, '8000', 'APIPORT', errors),
  shutdownTimeoutMs: parsePositiveInt(process.env.SHUTDOWN_TIMEOUT_MS, '5000', 'SHUTDOWN_TIMEOUT_MS', errors),
};

const initial = validateRuntime(
  {
    algorithm: process.env.ALGORITHM,
    limit: process.env.RATE_LIMIT,
    windowSeconds: process.env.WINDOW_SECONDS,
    redisEnabled: process.env.REDIS_ENABLED,
    failMode: process.env.FAIL_MODE,
  },
  { algorithm: 'fixed-window', limit: 10, windowSeconds: 60, redisEnabled: false, failMode: 'open' }
);
errors.push(...initial.errors);

if (errors.length) {
  // Fail fast and loud: a misconfigured limiter should never start silently.
  throw new Error(`Invalid limiter configuration:\n  - ${errors.join('\n  - ')}`);
}

// Mutable at runtime via POST /admin/config — read it per request, never cache it.
const runtime = initial.value;

function updateRuntime(partial) {
  const { value, errors: errs } = validateRuntime(partial, runtime);
  if (errs.length) return { ok: false, errors: errs };
  Object.assign(runtime, value);
  return { ok: true, config: { ...runtime } };
}

module.exports = { config, runtime, updateRuntime, ALGORITHMS };
