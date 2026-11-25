import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/sessions";
import { prisma } from "@/lib/prisma";
import { getWalletBalance } from "@/lib/wallet/service";
import { getSettings } from "@/lib/settings";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user, walletBalancePaise, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        dateOfBirth: true,
      },
    }),
    getWalletBalance(prisma, sessionUser.id),
    getSettings(),
  ]);

  return NextResponse.json({
    user: user
      ? {
          ...user,
          storeCreditBalance: walletBalancePaise,
        }
      : null,
    walletBalancePaise,
    walletMaxPercentOfOrder: settings.walletMaxPercentOfOrder ?? 100,
  });
}
