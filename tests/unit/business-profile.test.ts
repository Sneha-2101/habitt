import { describe, it, expect } from "vitest";
import { buildBusinessProfile } from "@/lib/site/business";

describe("business-profile", () => {
  it("returns null for all missing or blank values with no hardcoded fallbacks", () => {
    const profile = buildBusinessProfile({
      businessName: "",
      businessTagline: "   ",
      supportEmail: "",
      orderSenderEmail: "",
      legalName: null,
      businessAddress: null,
      businessPhone: "",
      businessState: null,
      businessPincode: null,
      grievanceOfficerName: null,
      grievanceOfficerEmail: "",
    });

    expect(profile.legalName).toBeNull();
    expect(profile.displayName).toBeNull();
    expect(profile.tagline).toBeNull();
    expect(profile.formattedAddress).toBeNull();
    expect(profile.phone).toBeNull();
    expect(profile.whatsapp).toBeNull();
    expect(profile.supportEmail).toBeNull();
    expect(profile.ordersEmail).toBeNull();
    expect(profile.replyToEmail).toBeNull();
    expect(profile.grievanceOfficer).toEqual({
      name: null,
      email: null,
      phone: null,
      address: null,
    });
    expect(profile.social).toEqual({
      instagramUrl: null,
      facebookUrl: null,
    });
  });

  it("formats structured address lines and preserves explicit values", () => {
    const profile = buildBusinessProfile({
      legalName: "Habitt Pvt Ltd",
      businessName: "habitt",
      businessAddressLine1: "102 Craft House",
      businessCity: "Ludhiana",
      businessState: "Punjab",
      businessPincode: "141001",
      supportEmail: "care@example.com",
      ordersEmail: "orders@example.com",
      replyToEmail: "reply@example.com",
      instagramUrl: "https://instagram.com/habitt",
    });

    expect(profile.formattedAddress).toBe("102 Craft House, Ludhiana, Punjab, 141001");
    expect(profile.ordersEmail).toBe("orders@example.com");
    expect(profile.replyToEmail).toBe("reply@example.com");
    expect(profile.social.instagramUrl).toBe("https://instagram.com/habitt");
    expect(profile.social.facebookUrl).toBeNull();
  });
});
