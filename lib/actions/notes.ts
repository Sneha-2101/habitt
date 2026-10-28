"use server";

import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function addOrderNote(orderId: string, body: string) {
  const user = await requireStaff();

  if (!body?.trim()) {
    throw new Error("Note content cannot be empty.");
  }

  const authorName = user.name || "Staff Member";

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
