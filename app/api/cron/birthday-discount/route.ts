import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendBirthdayDiscountEmail } from "@/lib/email";
import crypto from "crypto";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getSettings();
    const discountPercent = settings.birthdayDiscountPercent || 10;

    const today = new Date();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate(); // 1-31
    const currentYear = today.getFullYear();

    // Fetch users with dateOfBirth set
    const usersWithDob = await prisma.user.findMany({
      where: {
        dateOfBirth: { not: null },
      },
      select: {
        id: true,
        name: true,
        email: true,
        dateOfBirth: true,
      },
    });

    // Filter users whose month and day match today
    const birthdayUsers = usersWithDob.filter((user) => {
      if (!user.dateOfBirth) return false;
      const dob = new Date(user.dateOfBirth);
      return dob.getMonth() + 1 === currentMonth && dob.getDate() === currentDay;
    });

    let generatedCount = 0;

    for (const user of birthdayUsers) {
      if (!user.email) continue;

      // Check if coupon already generated for this user this year
      const userTag = user.id.slice(-6).toUpperCase();
      const codePrefix = `BDAY-${currentYear}-${userTag}`;
      const existingCoupon = await prisma.coupon.findFirst({
        where: {
          code: { startsWith: codePrefix },
        },
      });

      if (existingCoupon) continue;

      const randomSuffix = crypto.randomBytes(2).toString("hex").toUpperCase();
      const code = `${codePrefix}-${randomSuffix}`;
      const expiresAt = new Date(today);
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days validity

      await prisma.coupon.create({
        data: {
          code,
          discountType: "PERCENT",
          value: discountPercent,
          usageLimit: 1,
          expiresAt,
        },
      });

      await sendBirthdayDiscountEmail(user.email, user.name || "Valued Customer", code, discountPercent);
      generatedCount++;
    }

    return NextResponse.json({
      success: true,
      birthdayUsersFound: birthdayUsers.length,
      couponsGenerated: generatedCount,
    });
  } catch (error: any) {
    console.error("[Cron Birthday Discount Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to process birthday discounts" }, { status: 500 });
  }
}
