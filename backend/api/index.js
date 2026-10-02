#!/usr/bin/env node
/**
 * api — the protected backend. One endpoint, no business logic; it exists so the
 * limiter has something real to sit in front of.
 */
'use strict';

const express = require('express');

const config = require('./src/config');

function logEvent(level, msg, extra) {
  const entry = Object.assign({ ts: new Date().toISOString(), level, service: 'api', msg }, extra || {});
  (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(entry) + '\n');
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
  res.json({ ok: true, service: 'api' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
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
