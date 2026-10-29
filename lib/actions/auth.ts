"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { hash } from "bcryptjs";
import { getClientIp } from "@/lib/client-ip";
import { limit } from "@/lib/ratelimit";

export async function signUp(formData: FormData) {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // Rate limit: signUpIp (5 per hour)
  const rl = await limit("signUpIp", ip);
  if (!rl.ok) {
    throw new Error("Too many sign up attempts. Please try again later.");
  }

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
