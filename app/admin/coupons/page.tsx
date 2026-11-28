import { redirect } from "next/navigation";

export default function AdminCouponsRedirect() {
  redirect("/admin/offers");
}
