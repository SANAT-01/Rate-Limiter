import http from "node:http";

// Talks to the Docker Engine API over the local socket (mounted into the
// container by docker-compose.yml).
const SOCKET_PATH = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

export const SERVICES = ["lb", "limiter1", "limiter2", "api", "redis"] as const;
export type Service = (typeof SERVICES)[number];

export function isService(value: unknown): value is Service {
  return typeof value === "string" && (SERVICES as readonly string[]).includes(value);
}

const ACTIONS = {
  "limiter2-up": { service: "limiter2", op: "start" },
  "limiter2-down": { service: "limiter2", op: "stop" },
  "redis-start": { service: "redis", op: "start" },
  "redis-stop": { service: "redis", op: "stop" },
} as const satisfies Record<string, { service: Service; op: "start" | "stop" }>;

export type ControlAction = keyof typeof ACTIONS;
export const CONTROL_ACTIONS = Object.keys(ACTIONS) as ControlAction[];

export function isControlAction(value: unknown): value is ControlAction {
  return typeof value === "string" && value in ACTIONS;
}

function dockerRequest(
  method: "GET" | "POST",
  path: string,
  timeoutMs: number
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET_PATH, method, path, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("docker API timeout")));
    req.on("error", reject);
    req.end();
  });
}

function apiError(status: number, body: Buffer): Error {
  let message = body.toString().trim();
  try {
    message = JSON.parse(message).message ?? message;
  } catch {}
  return new Error(`docker API ${status}: ${message || "no body"}`);
}

export async function runControlAction(action: ControlAction): Promise<void> {
  const { service, op } = ACTIONS[action];
  const path = op === "stop" ? `/containers/${service}/stop?t=5` : `/containers/${service}/start`;
  const { status, body } = await dockerRequest("POST", path, 20_000);
  // 304 = already in the requested state; treat as success.
  if (status !== 204 && status !== 304) throw apiError(status, body);
}

export interface ServiceStatus {
  service: Service;
  state: string;
  health: string | null;
}

export async function getServiceStatus(service: Service): Promise<ServiceStatus> {
  const { status, body } = await dockerRequest("GET", `/containers/${service}/json`, 5_000);
  if (status === 404) return { service, state: "missing", health: null };
  if (status !== 200) throw apiError(status, body);
  const info = JSON.parse(body.toString());
  return { service, state: info.State?.Status ?? "unknown", health: info.State?.Health?.Status ?? null };
}

// Non-TTY containers return logs multiplexed: each frame is an 8-byte header
// (stream type, 3 zero bytes, uint32 big-endian length) followed by the payload.
function demuxLogs(buf: Buffer): string {
  const out: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const type = buf[offset];
    if (type > 2 || buf[offset + 1] || buf[offset + 2] || buf[offset + 3]) {
      return buf.toString();
    }
    const size = buf.readUInt32BE(offset + 4);
    out.push(buf.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(out).toString();
}

export async function getServiceLogs(service: Service, lines: number): Promise<string> {
  const tail = Number.isFinite(lines) ? Math.min(200, Math.max(1, Math.trunc(lines))) : 15;
  const { status, body } = await dockerRequest(
    "GET",
    `/containers/${service}/logs?stdout=1&stderr=1&tail=${tail}`,
    10_000
  );
  if (status !== 200) throw apiError(status, body);
  return demuxLogs(body);
}
