#!/usr/bin/env python3
"""limiter — a fixed-window rate limiter that fronts the api service.

Every request is counted against the calling client (the X-Client header, or the
caller's IP) inside the current window:

  * REDIS_ENABLED=false -> the counter is a plain in-process dict. Each limiter
        replica counts ALONE — run two replicas behind a load balancer and each
        one happily allows the full limit. That's the fail moment.
  * REDIS_ENABLED=true  -> the counter is a shared Redis INCR (atomic), so all
        replicas see the same numbers and the limit holds globally.

Allowed requests are proxied through to the api service and answered with
X-RateLimit-* headers; over-limit requests get a 429 with Retry-After.

Logs (one line per decision):
  ALLOW <client> 3/10 (local|redis) [limiter1]
  DENY  <client> 11/10 -> 429 [limiter1]
  REDIS DOWN — failing OPEN (request allowed, uncounted) [limiter1]

If Redis is unreachable, FAIL_MODE decides: "open" allows the request uncounted,
"closed" rejects it with 503. Standard library only — no pip deps.
"""
import json
import os
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME = os.environ.get("LIMITER_NAME", socket.gethostname())
LIMIT = int(os.environ.get("RATE_LIMIT", "10"))
WINDOW = int(os.environ.get("WINDOW_SECONDS", "60"))
REDIS_ENABLED = os.environ.get("REDIS_ENABLED", "false").lower() == "true"
FAIL_MODE = os.environ.get("FAIL_MODE", "open").lower()
REDISHOST = os.environ.get("REDISHOST", "redis")
APIHOST = os.environ.get("APIHOST", "api")

_local_counts = {}
_local_lock = threading.Lock()


# ----------------------------- minimal Redis (RESP) -----------------------------
def _redis(*args):
    with socket.create_connection((REDISHOST, 6379), timeout=3) as s:
        cmd = b"*%d\r\n" % len(args)
        for a in args:
            b = str(a).encode()
            cmd += b"$%d\r\n%s\r\n" % (len(b), b)
        s.sendall(cmd)
        f = s.makefile("rb")
        line = f.readline()
        tag, rest = line[:1], line[1:].strip()
        if tag == b"+":
            return rest.decode()
        if tag == b"-":
            raise RuntimeError(rest.decode())
        if tag == b":":
            return int(rest)
        if tag == b"$":
            n = int(rest)
            if n == -1:
                return None
            data = f.read(n)
            f.read(2)
            return data.decode()
        return None


def count_request(client):
    """Increment and return this client's count in the current window.

    Returns (count, backend) where backend is "local" or "redis".
    Raises on Redis failure so the caller can apply FAIL_MODE.
    """
    window = int(time.time() // WINDOW)
    if REDIS_ENABLED:
        key = "rate:%s:%d" % (client, window)
        n = _redis("INCR", key)
        if n == 1:
            # First hit in this window: bound the key's life to two windows.
            _redis("EXPIRE", key, WINDOW * 2)
        return n, "redis"
    with _local_lock:
        k = (client, window)
        _local_counts[k] = _local_counts.get(k, 0) + 1
        return _local_counts[k], "local"


# ----------------------------------- HTTP --------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, code, obj, extra_headers=None):
        data = (json.dumps(obj) + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        client = self.headers.get("X-Client") or self.client_address[0]
        try:
            n, backend = count_request(client)
        except Exception:
            if FAIL_MODE == "closed":
                print("REDIS DOWN — failing CLOSED -> 503 [%s]" % NAME, flush=True)
                self._json(503, {"error": "rate limiter unavailable"})
                return
            print("REDIS DOWN — failing OPEN (request allowed, uncounted) [%s]" % NAME, flush=True)
            self.forward(client, remaining=None)
            return
        if n > LIMIT:
            retry_after = WINDOW - (int(time.time()) % WINDOW)
            print("DENY  %s %d/%d -> 429 [%s]" % (client, n, LIMIT, NAME), flush=True)
            self._json(429, {"error": "rate limit exceeded", "limit": LIMIT}, [
                ("Retry-After", str(retry_after)),
                ("X-RateLimit-Limit", str(LIMIT)),
                ("X-RateLimit-Remaining", "0"),
            ])
            return
        print("ALLOW %s %d/%d (%s) [%s]" % (client, n, LIMIT, backend, NAME), flush=True)
        self.forward(client, remaining=LIMIT - n)

    def forward(self, client, remaining):
        try:
            with urllib.request.urlopen("http://%s:8000%s" % (APIHOST, self.path), timeout=5) as r:
                body = r.read()
        except Exception:
            self._json(502, {"error": "api unavailable"})
            return
        headers = [("X-Limiter", NAME), ("X-RateLimit-Limit", str(LIMIT))]
        if remaining is not None:
            headers.append(("X-RateLimit-Remaining", str(remaining)))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # our own ALLOW/DENY lines above are the interesting ones


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
