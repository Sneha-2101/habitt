"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Address line 1 is required"),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  country: z.string().default("India"),
});

export type UpdateShippingAddressInput = z.infer<typeof addressSchema>;

export async function updateOrderShippingAddress(
  orderId: string,
  formData: FormData | Record<string, unknown>
) {
  const staff = await requireStaff();

  const getField = (key: string): string | undefined => {
    if (typeof FormData !== "undefined" && formData instanceof FormData) {
      const val = formData.get(key);
      return val ? String(val).trim() : undefined;
    }
    const val = (formData as Record<string, unknown>)[key];
    return val !== undefined && val !== null ? String(val).trim() : undefined;
  };

  const raw = {
    line1: getField("line1") || getField("addressLine1") || getField("street") || "",
    line2: getField("line2") || getField("addressLine2"),
    city: getField("city") || "",
    state: getField("state") || "",
    pincode: getField("pincode") || getField("postalCode") || "",
    country: getField("country") || "India",
  };

  const validatedAddress = addressSchema.parse(raw);

  const staffName = staff.name || staff.email || "Staff";

  return await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, shippingAddress: true },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status !== "PENDING" && order.status !== "PAID") {
      throw new Error(
        `Cannot update shipping address for order in status ${order.status}. Allowed only for PENDING or PAID.`
      );
    }

    const oldAddr =
      typeof order.shippingAddress === "object" && order.shippingAddress !== null
        ? (order.shippingAddress as Record<string, string | undefined>)
        : {};

    const oldFormatted = [
      oldAddr.line1 || oldAddr.addressLine1 || oldAddr.street,
      oldAddr.line2 || oldAddr.addressLine2,
      oldAddr.city,
      oldAddr.state,
      oldAddr.pincode || oldAddr.postalCode,
    ]
      .filter(Boolean)
      .join(", ");

    const newFormatted = [
      validatedAddress.line1,
      validatedAddress.line2,
      validatedAddress.city,
      validatedAddress.state,
      validatedAddress.pincode,
    ]
      .filter(Boolean)
      .join(", ");

    const truncatedOld = oldFormatted.slice(0, 200);
    const truncatedNew = newFormatted.slice(0, 200);

    const updateRes = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { in: ["PENDING", "PAID"] },
      },
      data: {
        shippingAddress: validatedAddress,
      },
    });

    if (updateRes.count === 0) {
      throw new Error("Order status changed or order not found");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: order.status,
        note: `Address edited by ${staffName}: ${truncatedOld} -> ${truncatedNew}`,
      },
    });

    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");

    return { success: true, shippingAddress: validatedAddress };
  });
}

