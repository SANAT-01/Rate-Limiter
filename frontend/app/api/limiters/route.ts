import { NextRequest, NextResponse } from "next/server";
import { applyConfig, getLimiters, resetCounters } from "@/lib/limiters";

export async function GET() {
  return NextResponse.json({ limiters: await getLimiters() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "config" && body.config && typeof body.config === "object") {
      return NextResponse.json({ ok: true, results: await applyConfig(body.config) });
    }
    if (body.action === "reset") {
      return NextResponse.json({ ok: true, results: await resetCounters() });
    }
    return NextResponse.json({ ok: false, error: 'action must be "config" or "reset"' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
