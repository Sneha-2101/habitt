import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeErrorSummary } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Health check database query failed:", safeErrorSummary(error));
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

