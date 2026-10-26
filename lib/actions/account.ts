"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function updateProfile(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const name = (formData.get("name") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
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

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name, phone: phone || null, dateOfBirth },
  });

  revalidatePath("/account");
}

export async function saveAddress(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const street = (formData.get("street") as string)?.trim();
  const city = (formData.get("city") as string)?.trim();
  const state = (formData.get("state") as string)?.trim();
  const pincode = (formData.get("pincode") as string)?.trim();

  if (!street || !city || !state || !pincode) {
    throw new Error("All address fields are required");
  }

  const existingDefault = await prisma.address.findFirst({
    where: { userId: session.user.id, isDefault: true },
  });

  if (existingDefault) {
    await prisma.address.update({
      where: { id: existingDefault.id },
      data: { street, city, state, pincode },
    });
  } else {
    await prisma.address.create({
      data: {
        userId: session.user.id,
        street,
        city,
        state,
        pincode,
        isDefault: true,
      },
    });
  }

  revalidatePath("/account");
}
