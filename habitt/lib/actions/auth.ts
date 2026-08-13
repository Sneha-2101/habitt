"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { hash } from "bcryptjs";

export async function signUp(formData: FormData) {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string;
  const password = formData.get("password") as string;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await hash(password, 10);

  await prisma.user.create({
    data: { name, email, phone, passwordHash, role: "CUSTOMER" },
  });

  redirect("/login");
}
