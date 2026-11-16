"use server";

import { requireUser } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { addressSchema } from "@/lib/validation/address";
import { Prisma } from "@prisma/client";

export async function updateProfile(formData: FormData) {
  const user = await requireUser();

  const name = (formData.get("name") as string)?.trim();
  const dobRaw = (formData.get("dateOfBirth") as string)?.trim();

  if (!name) {
    throw new Error("Name is required");
  }

  let dateOfBirth: Date | null = null;
  if (dobRaw) {
    const parsed = new Date(dobRaw);
    if (!isNaN(parsed.getTime())) {
      dateOfBirth = parsed;
    }
  }

  // SECURITY: phone is excluded to prevent account takeover without OTP verification
  await prisma.user.update({
    where: { id: user.id },
    data: { name, dateOfBirth },
  });

  revalidatePath("/account");
}

export async function listAddresses() {
  const user = await requireUser();
  return prisma.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
}

export async function createAddress(input: unknown) {
  const user = await requireUser();
  const data = addressSchema.parse(input);

  async function executeCreate() {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('address:' || ${user.id}))`;

      const count = await tx.address.count({
        where: { userId: user.id },
      });

      if (count >= 10) {
        throw new Error("Maximum of 10 addresses allowed.");
      }

      const isFirst = count === 0;
      const shouldBeDefault = isFirst || Boolean(data.isDefault);

      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      return await tx.address.create({
        data: {
          userId: user.id,
          fullName: data.fullName,
          phone: data.phone,
          street: data.line1,
          line2: data.line2,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          label: data.label,
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  let result;
  try {
    result = await executeCreate();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      result = await executeCreate();
    } else {
      throw err;
    }
  }

  revalidatePath("/account");
  return result;
}

export async function updateAddress(id: string, input: unknown) {
  const user = await requireUser();

  const existing = await prisma.address.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    throw new Error("Address not found");
  }

  const data = addressSchema.parse(input);
  const shouldBeDefault = Boolean(data.isDefault);

  async function executeUpdate() {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('address:' || ${user.id}))`;

      if (shouldBeDefault && !existing!.isDefault) {
        await tx.address.updateMany({
          where: { userId: user.id, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      return await tx.address.update({
        where: { id: existing!.id },
        data: {
          fullName: data.fullName,
          phone: data.phone,
          street: data.line1,
          line2: data.line2,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          label: data.label,
          isDefault: shouldBeDefault ? true : existing!.isDefault,
        },
      });
    });
  }

  let result;
  try {
    result = await executeUpdate();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      result = await executeUpdate();
    } else {
      throw err;
    }
  }

  revalidatePath("/account");
  return result;
}

export async function deleteAddress(id: string) {
  const user = await requireUser();

  const existing = await prisma.address.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    throw new Error("Address not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('address:' || ${user.id}))`;

    await tx.address.delete({
      where: { id: existing.id },
    });

    if (existing.isDefault) {
      const nextDefault = await tx.address.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
      });

      if (nextDefault) {
        await tx.address.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }
  });

  revalidatePath("/account");
  return { success: true };
}

export async function setDefaultAddress(id: string) {
  const user = await requireUser();

  const target = await prisma.address.findFirst({
    where: { id, userId: user.id },
  });

  if (!target) {
    throw new Error("Address not found");
  }

  async function executeSetDefault() {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('address:' || ${user.id}))`;

      await tx.address.updateMany({
        where: { userId: user.id, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });

      return await tx.address.update({
        where: { id: target!.id },
        data: { isDefault: true },
      });
    });
  }

  let result;
  try {
    result = await executeSetDefault();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      result = await executeSetDefault();
    } else {
      throw err;
    }
  }

  revalidatePath("/account");
  return result;
}
