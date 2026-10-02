#!/usr/bin/env node
/**
 * api — the protected backend. One endpoint, no business logic; it exists so the
 * limiter has something real to sit in front of. No third-party dependencies.
 */
'use strict';

const http = require('http');

const config = require('./src/config');

function logEvent(level, msg, extra) {
  const entry = Object.assign({ ts: new Date().toISOString(), level, service: 'api', msg }, extra || {});
  (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(entry) + '\n');
}

function sendJson(res, code, obj) {
  const data = JSON.stringify(obj) + '\n';
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(404);
    res.end();
    return;
  }
  if (req.url === '/healthz') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  sendJson(res, 200, { ok: true, service: 'api' });
});

server.listen(config.port, '0.0.0.0', () => {
  logEvent('info', `api listening on :${config.port}`);
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
