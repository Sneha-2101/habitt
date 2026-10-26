import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ address: null });
  }

  const userId = (session.user as { id: string }).id;
  const address = await prisma.address.findFirst({
    where: { userId, isDefault: true },
    select: { id: true, street: true, city: true, state: true, pincode: true },
  });

  return NextResponse.json({ address: address || null });
}
