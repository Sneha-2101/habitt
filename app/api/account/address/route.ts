import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/sessions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ address: null });
  }

  const userId = sessionUser.id;
  const address = await prisma.address.findFirst({
    where: { userId, isDefault: true },
    select: { id: true, street: true, city: true, state: true, pincode: true },
  });

  return NextResponse.json({ address: address || null });
}
