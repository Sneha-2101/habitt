import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { expireWalletLots, enqueueWalletExpiryWarnings } from "@/lib/wallet/service";
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
    const result = await withCronRun("wallet-expiry", async () => {
      const now = new Date();
      const res = await expireWalletLots(now);
      const warnings = await enqueueWalletExpiryWarnings(now);
      return {
        itemsProcessed: res.expiredCount + warnings.warnedCount,
        ...res,
        warnedCount: warnings.warnedCount,
      };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Wallet expiry cron failed",
      },
      { status: 500 }
    );
  }
}
