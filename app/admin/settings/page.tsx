import { getSettings } from "@/lib/settings";
import AdminSettingsForm from "./AdminSettingsForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getSettings();

  return (
    <main className="px-7 py-9 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-xs text-stone-dark">
        <Link href="/admin" className="hover:underline">
          Dashboard
        </Link>
        <span>/</span>
        <span className="text-ink font-medium">Settings</span>
      </div>

      <div>
        <h1 className="font-display text-2xl font-medium text-ink">Store Settings</h1>
        <p className="text-xs text-stone-dark mt-1">Manage global payments, shipping, tax, contacts, marketing, and policy rules.</p>
      </div>

      <AdminSettingsForm
        initialSettings={{
          codEnabled: settings.codEnabled,
          codOrderCap: settings.codOrderCap,
          shippingFee: settings.shippingFee,
          freeShippingThreshold: settings.freeShippingThreshold,
          codFeeEnabled: settings.codFeeEnabled,
          codFee: settings.codFee,
          gstEnabled: settings.gstEnabled,
          gstRate: settings.gstRate,
          gstin: settings.gstin,
          businessName: settings.businessName,
          businessTagline: settings.businessTagline,
          supportEmail: settings.supportEmail,
          orderSenderEmail: settings.orderSenderEmail,
          businessAddress: settings.businessAddress,
          lowStockThreshold: settings.lowStockThreshold,
          welcomeCouponCode: settings.welcomeCouponCode,
          welcomeCouponPercent: settings.welcomeCouponPercent,
          birthdayDiscountPercent: settings.birthdayDiscountPercent,
          returnWindowDays: settings.returnWindowDays,
          abandonedCartDelayHours: settings.abandonedCartDelayHours,
          freeShippingOnPrepaid: settings.freeShippingOnPrepaid,
          codRequiresDeliveredOrder: settings.codRequiresDeliveredOrder,
          freeReturnShipping: settings.freeReturnShipping,
          refundProcessingHours: settings.refundProcessingHours,
          maxDeliveryDays: settings.maxDeliveryDays,
          legalName: settings.legalName,
          businessPhone: settings.businessPhone,
          businessState: settings.businessState,
          businessPincode: settings.businessPincode,
          whatsappSupportNumber: settings.whatsappSupportNumber,
          shiprocketPickupLocation: settings.shiprocketPickupLocation,
          grievanceOfficerName: settings.grievanceOfficerName,
          grievanceOfficerEmail: settings.grievanceOfficerEmail,
          grievanceOfficerPhone: settings.grievanceOfficerPhone,
          grievanceOfficerAddress: settings.grievanceOfficerAddress,
          businessAddressLine1: settings.businessAddressLine1,
          businessAddressLine2: settings.businessAddressLine2,
          businessCity: settings.businessCity,
          pickupAddressLine1: settings.pickupAddressLine1,
          pickupAddressLine2: settings.pickupAddressLine2,
          pickupCity: settings.pickupCity,
          pickupPincode: settings.pickupPincode,
          pickupPhone: settings.pickupPhone,
          ordersEmail: settings.ordersEmail,
          replyToEmail: settings.replyToEmail,
          dispatchHandlingNote: settings.dispatchHandlingNote,
          instagramUrl: settings.instagramUrl,
          facebookUrl: settings.facebookUrl,
        }}
      />
    </main>
  );
}
