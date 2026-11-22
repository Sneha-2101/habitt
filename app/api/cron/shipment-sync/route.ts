import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { syncShipmentsBatch } from "@/lib/shipping/sync";
import { withCronRun } from "@/lib/cron/run-log";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new NextResponse("cron not configured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const expectedHeader = `Bearer ${cronSecret}`;
  if (!authHeader) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const authBuffer = Buffer.from(authHeader);
  const expectedBuffer = Buffer.from(expectedHeader);
  if (
    authBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(authBuffer, expectedBuffer)
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await withCronRun("shipment-sync", async () => {
      return await syncShipmentsBatch(25);
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Shipment sync failed",
      },
      { status: 500 }
    );
  }
}
