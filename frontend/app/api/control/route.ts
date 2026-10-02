import { NextRequest, NextResponse } from "next/server";
import { CONTROL_ACTIONS, getServiceStatus, isControlAction, runControlAction } from "@/lib/docker";
import { syncLimiter } from "@/lib/limiters";

async function waitUntilRunning(service: "redis" | "limiter2") {
  for (let i = 0; i < 20; i++) {
    if ((await getServiceStatus(service)).state === "running") return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  if (!isControlAction(action)) {
    return NextResponse.json(
      { ok: false, error: `action must be one of: ${CONTROL_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    await runControlAction(action);
    let synced: boolean | undefined;
    if (action === "limiter2-up") {
      await waitUntilRunning("limiter2");
      synced = await syncLimiter("limiter2");
    }
    if (action === "redis-start") {
      await waitUntilRunning("redis");
      await new Promise((r) => setTimeout(r, 300));
    }
    return NextResponse.json({ ok: true, action, synced });
  } catch (err) {
    return NextResponse.json(
      { ok: false, action, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
