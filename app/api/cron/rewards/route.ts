import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { withCronRun } from "@/lib/cron/run-log";
import {
  expireStaleReferrals,
  releaseLoyaltyAccruals,
  releaseReferrerRewards,
  sweepPendingRefereeCredits,
} from "@/lib/rewards/service";

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
    const result = await withCronRun("rewards", async () => {
      const swept = await sweepPendingRefereeCredits();
      const expired = await expireStaleReferrals();
      const loyalty = await releaseLoyaltyAccruals();
      const referrer = await releaseReferrerRewards();
      const itemsProcessed =
        swept.grantedCount +
        expired.expiredCount +
        loyalty.creditedCount +
        loyalty.skippedCount +
        referrer.rewardedCount +
        referrer.rejectedCount;
      const errorCount =
        swept.errorCount + loyalty.errorCount + referrer.errorCount;
      return {
        itemsProcessed,
        errorCount,
        swept,
        expired,
        loyalty,
        referrer,
      };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Rewards cron failed",
      },
      { status: 500 }
    );
  }
}
