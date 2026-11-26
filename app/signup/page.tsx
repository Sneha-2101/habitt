import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign Up",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  redirect("/login");
}
