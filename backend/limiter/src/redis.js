'use strict';

const net = require('net');

// Minimal hand-rolled Redis client (RESP2) — enough for EVAL, PING and FLUSHDB.
// One short-lived connection per command keeps it dependency-free and simple.

class RedisError extends Error {}

// Parses one reply starting at `offset`. Returns null if the buffer doesn't yet
// hold the complete reply (wait for more data).
function parseReply(buf, offset) {
  const nl = buf.indexOf('\r\n', offset);
  if (nl === -1) return null;
  const tag = String.fromCharCode(buf[offset]);
  const line = buf.toString('utf8', offset + 1, nl);
  const next = nl + 2;

  switch (tag) {
    case '+':
      return { value: line, offset: next };
    case '-':
      return { value: new RedisError(line), offset: next };
    case ':':
      return { value: parseInt(line, 10), offset: next };
    case '$': {
      const n = parseInt(line, 10);
      if (n === -1) return { value: null, offset: next };
      if (buf.length < next + n + 2) return null;
      return { value: buf.toString('utf8', next, next + n), offset: next + n + 2 };
    }
    case '*': {
      const n = parseInt(line, 10);
      if (n === -1) return { value: null, offset: next };
      const items = [];
      let off = next;
      for (let i = 0; i < n; i++) {
        const r = parseReply(buf, off);
        if (!r) return null;
        items.push(r.value);
        off = r.offset;
      }
      return { value: items, offset: off };
    }
    default:
      throw new RedisError(`unexpected RESP reply type "${tag}"`);
  }
}

function redisCommand(host, port, timeoutMs, ...args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    const succeed = (val) => {
      if (settled) return;
      settled = true;
      socket.end();
      resolve(val);
    };

    socket.setTimeout(timeoutMs, () => fail(new Error('redis timeout')));
    socket.on('error', fail);

    socket.on('connect', () => {
      let cmd = `*${args.length}\r\n`;
      for (const a of args) {
        const s = String(a);
        cmd += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
      }
      socket.write(cmd);
    });

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let reply;
      try {
        reply = parseReply(buf, 0);
      } catch (err) {
        return fail(err);
      }
      if (!reply) return;
      if (reply.value instanceof RedisError) return fail(reply.value);
      succeed(reply.value);
    });
  });
}

module.exports = { redisCommand };
