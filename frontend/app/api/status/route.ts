import { NextResponse } from "next/server";
import { SERVICES, getServiceStatus } from "@/lib/docker";

export async function GET() {
  try {
    const services = await Promise.all(SERVICES.map(getServiceStatus));
    return NextResponse.json({ services });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
