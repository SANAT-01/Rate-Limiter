import { NextRequest, NextResponse } from "next/server";
import { getServiceLogs, isService } from "@/lib/docker";

export async function GET(request: NextRequest) {
  const service = request.nextUrl.searchParams.get("service") || "limiter1";
  const lines = parseInt(request.nextUrl.searchParams.get("lines") || "15", 10);

  if (!isService(service)) {
    return NextResponse.json({ error: `Unknown service: ${service}` }, { status: 400 });
  }

  try {
    const logs = await getServiceLogs(service, lines);
    return NextResponse.json({ service, logs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
