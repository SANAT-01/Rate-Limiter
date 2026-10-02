#!/usr/bin/env node
/**
 * limiter — a rate limiter that fronts the api service.
 *
 * Every request is counted against the calling client (the X-Client header, or the
 * caller's IP) using the configured algorithm:
 *   fixed-window | sliding-log | sliding-window | token-bucket
 *
 * The counter store is either this process's memory (redisEnabled=false — each
 * replica counts alone, so two replicas behind a load balancer allow 2x) or Redis
 * (redisEnabled=true — one atomic Lua script per decision, shared by all replicas).
 *
 * Settings start from env vars and can be changed live via the admin API, which
 * nginx refuses to proxy (only reachable on the internal Docker network):
 *   GET  /admin/config   POST /admin/config   GET /admin/stats   POST /admin/reset
 *
 * Decision logs (one line per request; the README greps for this text):
 *   ALLOW <client> 3/10 (local|redis) fixed-window [limiter1]
 *   DENY  <client> 11/10 -> 429 (redis) fixed-window [limiter1]
 *   REDIS DOWN — failing OPEN (request allowed, uncounted) [limiter1]
 */
'use strict';

const http = require('http');

const express = require('express');

const { config, runtime, updateRuntime } = require('./src/config');
const { redisCommand } = require('./src/redis');
const { ALGORITHM_IMPLS, resetLocal } = require('./src/algorithms');

const REDIS_TIMEOUT_MS = 1000;
const redisCall = (...args) => redisCommand(config.redisHost, config.redisPort, REDIS_TIMEOUT_MS, ...args);

let stats = freshStats();

function freshStats() {
  return { allowed: 0, denied: 0, failedOpen: 0, failedClosed: 0, since: new Date().toISOString() };
}

function logEvent(level, msg, extra) {
  const entry = Object.assign({ ts: new Date().toISOString(), level, service: config.name, msg }, extra || {});
  (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(entry) + '\n');
}

async function decide(client, cfg) {
  const impl = ALGORITHM_IMPLS[cfg.algorithm];
  const now = Date.now();
  if (cfg.redisEnabled) return { ...(await impl.redis(redisCall, client, cfg, now)), backend: 'redis' };
  return { ...impl.local(client, cfg, now), backend: 'local' };
}

// ----------------------------------- HTTP --------------------------------------
function sendJson(res, code, obj, extraHeaders) {
  const data = JSON.stringify(obj) + '\n';
  res.set(extraHeaders || {});
  res.status(code).type('application/json').send(data);
}

function rateHeaders(cfg, backend, remaining) {
  const h = {
    'X-Limiter': config.name,
    'X-RateLimit-Limit': String(cfg.limit),
    'X-RateLimit-Algorithm': cfg.algorithm,
    'X-RateLimit-Backend': backend,
  };
  if (remaining !== null) h['X-RateLimit-Remaining'] = String(remaining);
  return h;
}

function forward(req, res, headers) {
  const proxyReq = http.request(
    { host: config.apiHost, port: config.apiPort, path: req.url, method: 'GET' },
    (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);
        res.set({ 'Content-Type': 'application/json', ...headers });
        res.status(200).send(body);
      });
    }
  );
  proxyReq.on('error', () => sendJson(res, 502, { error: 'api unavailable' }, headers));
  proxyReq.end();
}

async function handleLimited(req, res) {
  const cfg = { ...runtime };
  const client = req.headers['x-client'] || req.socket.remoteAddress;

  let decision;
  try {
    decision = await decide(client, cfg);
  } catch {
    if (cfg.failMode === 'closed') {
      stats.failedClosed++;
      console.log(`REDIS DOWN — failing CLOSED -> 503 [${config.name}]`);
      return sendJson(res, 503, { error: 'rate limiter unavailable' }, rateHeaders(cfg, 'none', null));
    }
    stats.failedOpen++;
    console.log(`REDIS DOWN — failing OPEN (request allowed, uncounted) [${config.name}]`);
    return forward(req, res, rateHeaders(cfg, 'none', null));
  }

  const { allowed, used, remaining, retryAfterMs, backend } = decision;
  const headers = rateHeaders(cfg, backend, remaining);

  if (!allowed) {
    stats.denied++;
    console.log(`DENY  ${client} ${used}/${cfg.limit} -> 429 (${backend}) ${cfg.algorithm} [${config.name}]`);
    return sendJson(res, 429, { error: 'rate limit exceeded', limit: cfg.limit, algorithm: cfg.algorithm }, {
      ...headers,
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
    });
  }

  stats.allowed++;
  console.log(`ALLOW ${client} ${used}/${cfg.limit} (${backend}) ${cfg.algorithm} [${config.name}]`);
  forward(req, res, headers);
}

// ----------------------------------- app ----------------------------------------
const app = express();
app.disable('x-powered-by');

app.get('/healthz', (req, res) => sendJson(res, 200, { status: 'ok' }));

app.get('/readyz', async (req, res) => {
  if (!runtime.redisEnabled) return sendJson(res, 200, { status: 'ready', backend: 'local' });
  try {
    await redisCall('PING');
    sendJson(res, 200, { status: 'ready', backend: 'redis' });
  } catch (err) {
    sendJson(res, 503, { status: 'not-ready', reason: err.message });
  }
});

app.get('/admin/config', (req, res) => sendJson(res, 200, { name: config.name, ...runtime }));

app.post('/admin/config', express.json({ limit: '10kb' }), (req, res) => {
  const result = updateRuntime(req.body || {});
  if (!result.ok) return sendJson(res, 400, { error: result.errors.join('; ') });
  logEvent('info', 'config updated', result.config);
  sendJson(res, 200, { name: config.name, ...result.config });
});

app.get('/admin/stats', (req, res) => sendJson(res, 200, { name: config.name, ...stats }));

app.post('/admin/reset', async (req, res) => {
  resetLocal();
  stats = freshStats();
  let redisFlushed = false;
  try {
    // This Redis exists only for the lab's counters, so wiping it is the reset.
    await redisCall('FLUSHDB');
    redisFlushed = true;
  } catch {}
  logEvent('info', 'counters reset', { redisFlushed });
  sendJson(res, 200, { name: config.name, reset: true, redisFlushed });
});

// Any other path/method under /admin is unknown.
app.all('/admin/*', (req, res) => sendJson(res, 404, { error: 'not found' }));

// Everything else is a request to rate-limit and forward to the api.
app.get('*', handleLimited);

// Non-GET, non-admin requests have nothing to match.
app.use((req, res) => res.status(404).end());

// express.json() parse errors (bad JSON, body too large) land here.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  sendJson(res, 400, { error: err.type === 'entity.too.large' ? 'request body too large' : 'invalid JSON body' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  logEvent('info', `limiter listening on :${config.port}`, { ...runtime });
});

// ------------------------------ lifecycle & safety ------------------------------
function shutdown(signal) {
  logEvent('info', `received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => {
    logEvent('warn', 'forced exit after shutdown timeout');
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logEvent('error', 'uncaught exception', { error: err.stack || String(err) });
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  logEvent('error', 'unhandled rejection', { error: err && err.stack ? err.stack : String(err) });
  process.exit(1);
});
