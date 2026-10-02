'use strict';

function parsePositiveInt(v, def, name, errors) {
  const n = parseInt(v !== undefined ? v : def, 10);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push(`${name} must be a positive integer (got "${v}")`);
  }
  return n;
}

const errors = [];

const config = {
  port: parsePositiveInt(process.env.PORT, '8000', 'PORT', errors),
  shutdownTimeoutMs: parsePositiveInt(process.env.SHUTDOWN_TIMEOUT_MS, '5000', 'SHUTDOWN_TIMEOUT_MS', errors),
};

if (errors.length) {
  throw new Error(`Invalid api configuration:\n  - ${errors.join('\n  - ')}`);
}

module.exports = config;
