import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../helpers/prisma";
import { SiteSettings } from "@prisma/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T33: Policy Pages and Footer Dynamic Rendering", () => {
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findFirst();
  });

  afterAll(async () => {
    if (originalSettings) {
      const { id, ...data } = originalSettings;
      await prisma.siteSettings.update({
        where: { id },
        data,
      });
    }
  });

  it("reflects distinctive settings on policy pages and footer", async () => {
    const distinctiveLegal = "Distinctive M1c Enterprise Private Limited";

    await prisma.siteSettings.update({
      where: { id: "default" },
      data: {
        legalName: distinctiveLegal,
        businessAddress: null,
        freeShippingOnPrepaid: true,
        maxDeliveryDays: 9,
        returnWindowDays: 14,
        freeReturnShipping: false,
        refundProcessingHours: 96,
      },
    });

    // 1. /policies/shipping
    const shipRes = await fetch(`${BASE_URL}/policies/shipping`);
    expect(shipRes.status).toBe(200);
    const shipHtml = (await shipRes.text()).replace(/<!--.*?-->/g, "");
    expect(shipHtml).toContain("9 business days");
    expect(shipHtml).toContain("Free Shipping");

    // 2. /policies/returns
    const retRes = await fetch(`${BASE_URL}/policies/returns`);
    expect(retRes.status).toBe(200);
    const retHtml = (await retRes.text()).replace(/<!--.*?-->/g, "");
    expect(retHtml).toContain("14-Day Easy Returns");
    expect(retHtml).toContain("within 96 hours of approving the return; how long your bank takes to credit it is outside our control");
    expect(retHtml).toContain("Standard return pickup fees may apply.");

    // 3. / (Home page footer)
    const homeRes = await fetch(`${BASE_URL}/`);
    expect(homeRes.status).toBe(200);
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain(distinctiveLegal);
  });
});
