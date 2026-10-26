"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function requireStaffOrOwner() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "STAFF" && role !== "OWNER")) {
    throw new Error("Unauthorized: Action requires STAFF or OWNER role.");
  }
  return session;
}

export async function addOrderNote(orderId: string, body: string) {
  const session = await requireStaffOrOwner();

  if (!body?.trim()) {
    throw new Error("Note content cannot be empty.");
  }

  const authorName = session.user?.name || "Staff Member";

  const note = await prisma.orderNote.create({
    data: {
      orderId,
      authorName,
      body: body.trim(),
    },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return note;
}
