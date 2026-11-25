import { getSettings } from "@/lib/settings";

export interface BusinessProfileInput {
  legalName?: string | null;
  businessName?: string | null;
  businessTagline?: string | null;
  businessAddress?: string | null;
  businessAddressLine1?: string | null;
  businessAddressLine2?: string | null;
  businessCity?: string | null;
  businessState?: string | null;
  businessPincode?: string | null;
  businessPhone?: string | null;
  whatsappSupportNumber?: string | null;
  supportEmail?: string | null;
  orderSenderEmail?: string | null;
  ordersEmail?: string | null;
  replyToEmail?: string | null;
  grievanceOfficerName?: string | null;
  grievanceOfficerEmail?: string | null;
  grievanceOfficerPhone?: string | null;
  grievanceOfficerAddress?: string | null;
  shiprocketPickupLocation?: string | null;
  pickupAddressLine1?: string | null;
  pickupAddressLine2?: string | null;
  pickupCity?: string | null;
  pickupPincode?: string | null;
  pickupPhone?: string | null;
  dispatchHandlingNote?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
}

export interface BusinessProfile {
  legalName: string | null;
  displayName: string | null;
  tagline: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  formattedAddress: string | null;
  phone: string | null;
  whatsapp: string | null;
  supportEmail: string | null;
  ordersEmail: string | null;
  replyToEmail: string | null;
  grievanceOfficer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  pickup: {
    location: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    pincode: string | null;
    phone: string | null;
  };
  dispatchHandlingNote: string | null;
  social: {
    instagramUrl: string | null;
    facebookUrl: string | null;
  };
}

function clean(val?: string | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure builder for BusinessProfile with NO hardcoded fallbacks.
 * Any missing or blank value becomes null.
 */
export function buildBusinessProfile(settings: BusinessProfileInput): BusinessProfile {
  const addressLine1 = clean(settings.businessAddressLine1);
  const addressLine2 = clean(settings.businessAddressLine2);
  const city = clean(settings.businessCity);
  const state = clean(settings.businessState);
  const pincode = clean(settings.businessPincode);

  const structuredParts = [addressLine1, addressLine2, city, state, pincode].filter(
    (p): p is string => p !== null
  );
  const formattedAddress =
    structuredParts.length > 0 ? structuredParts.join(", ") : clean(settings.businessAddress);

  const supportEmail = clean(settings.supportEmail);
  const ordersEmail = clean(settings.ordersEmail) ?? clean(settings.orderSenderEmail);
  const replyToEmail = clean(settings.replyToEmail) ?? supportEmail;

  return {
    legalName: clean(settings.legalName),
    displayName: clean(settings.businessName),
    tagline: clean(settings.businessTagline),
    addressLine1,
    addressLine2,
    city,
    state,
    pincode,
    formattedAddress,
    phone: clean(settings.businessPhone),
    whatsapp: clean(settings.whatsappSupportNumber),
    supportEmail,
    ordersEmail,
    replyToEmail,
    grievanceOfficer: {
      name: clean(settings.grievanceOfficerName),
      email: clean(settings.grievanceOfficerEmail),
      phone: clean(settings.grievanceOfficerPhone),
      address: clean(settings.grievanceOfficerAddress),
    },
    pickup: {
      location: clean(settings.shiprocketPickupLocation),
      addressLine1: clean(settings.pickupAddressLine1),
      addressLine2: clean(settings.pickupAddressLine2),
      city: clean(settings.pickupCity),
      pincode: clean(settings.pickupPincode),
      phone: clean(settings.pickupPhone),
    },
    dispatchHandlingNote: clean(settings.dispatchHandlingNote),
    social: {
      instagramUrl: clean(settings.instagramUrl),
      facebookUrl: clean(settings.facebookUrl),
    },
  };
}

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const settings = await getSettings();
  return buildBusinessProfile(settings);
}
